
const MARGIN = { top: 30, right: 20, bottom: 30, left: 20 };
let WIDTH, HEIGHT, INNER_W, INNER_H;

let currentIndex = 0;
let shelterPositions = new Map();

function computeSize() {
  const graphic = document.querySelector("#scrolly-periods .graphic");
  const rect = graphic.getBoundingClientRect();

  WIDTH = Math.max(320, rect.width);
  HEIGHT = Math.max(420, window.innerHeight * 0.9);

  INNER_W = WIDTH - MARGIN.left - MARGIN.right;
  INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom;

  d3.select("#viz")
    .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
}

// svg and globals

const svg = d3.select("#viz");
const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

const overlayEl = document.getElementById("overlay-period");
const legendEl = document.getElementById("legend");
const tooltipEl = d3.select("#tooltip");

const color = d3.scaleOrdinal(d3.schemeTableau10);
const rScale = d3.scaleSqrt().range([4, 55]);

let periods = [];
let cumulativePerPeriod = [];
let sheltersList = [];

const parseDate = d => d ? new Date(d) : null;
const fShort = d3.timeFormat("%b %d, %Y");

// load data

d3.csv("data/grievances.csv").then(raw => {
  const rows = raw
    .map(d => ({
      shelter: d["Emergency Temporary Shelter"]?.trim(),
      start: parseDate(d["Period Start"]),
      total: +d["Total"] || 0
    }))
    .filter(d => d.shelter && d.start);

  periods = Array.from(new Set(rows.map(d => +d.start)))
    .sort((a, b) => a - b)
    .map(t => new Date(t));

  sheltersList = Array.from(new Set(rows.map(d => d.shelter))).sort();

  const running = new Map();
  let grandRunning = 0;

  cumulativePerPeriod = periods.map(p => {
    const key = +p;
    const frameRows = rows.filter(r => +r.start === key);

    let periodSum = 0;
    frameRows.forEach(r => {
      running.set(r.shelter, (running.get(r.shelter) || 0) + r.total);
      periodSum += r.total;
    });

    grandRunning += periodSum;

    const nodes = sheltersList.map(s => ({
      shelter: s,
      total: running.get(s) || 0
    })).filter(d => d.total > 0 || d.shelter === "Daley College");

    return {
      period: p,
      nodes,
      periodSum,
      cumulativeSum: grandRunning
    };
  });

  rScale.domain([
    0,
    d3.max(cumulativePerPeriod, f => d3.max(f.nodes, n => n.total)) || 1
  ]);

  computeSize();
  buildSteps(cumulativePerPeriod);
  initScene();
  setupScroller();

  window.addEventListener("resize", onResize);
});

/* =====================
   Steps + legend
===================== */

function buildSteps(frames) {
  d3.selectAll("#steps .step").each(function (_, i) {
    const frame = frames[i];
    if (!frame) return;

    const step = d3.select(this);

    step.insert("h3", ":first-child")
      .text(`${fShort(frame.period)} — ${frame.periodSum} grievances`);

    step.insert("p", ":nth-child(2)")
      .text(`Total so far: ${frame.cumulativeSum}`);
  });

  legendEl.innerHTML = `
    <div class="legend-inner">
      <div><strong>Bubble:</strong> Shelter</div>
      <div><strong>Size:</strong> Cumulative grievances</div>
      <div>Tap or hover for details</div>
      <hr/>
      <em>Daley College appears gray when operating with zero reports.</em>
    </div>
  `;
}

/* =====================
   Layout positions
===================== */

function computeShelterPositions() {
  const cols =
    WIDTH < 420 ? 2 :
    WIDTH < 700 ? 3 :
    WIDTH < 1000 ? 4 : 6;

  const rows = Math.ceil(sheltersList.length / cols);
  const spacingX = INNER_W / (cols + 1);
  const spacingY = INNER_H / (rows + 1);

  shelterPositions.clear();

  sheltersList.forEach((s, i) => {
    shelterPositions.set(s, {
      x: spacingX * (i % cols + 1),
      y: spacingY * (Math.floor(i / cols) + 1)
    });
  });
}

//scene

let nodeSel, labelSel;

function initScene() {
  g.append("g").attr("class", "nodes");
  g.append("g").attr("class", "labels");

  computeShelterPositions();
  updatePeriod(0, true);
}

function updatePeriod(index, instant = false) {
  const frame = cumulativePerPeriod[index];
  if (!frame) return;

  currentIndex = index;
  overlayEl.textContent = `Period: ${fShort(frame.period)}`;

  // Remove active class from all steps, add it to current one
  d3.selectAll(".step").classed("active", false);
  d3.selectAll(`.step[data-index="${index}"]`).classed("active", true);

  frame.nodes.forEach(d => Object.assign(d, shelterPositions.get(d.shelter)));

  nodeSel = g.select(".nodes")
    .selectAll("circle")
    .data(frame.nodes, d => d.shelter);

  nodeSel.exit().transition().duration(200).attr("r", 0).remove();

  const enter = nodeSel.enter().append("circle")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", 0)
    .attr("fill", d => color(d.shelter))
    .attr("opacity", 0.85)
    .on("pointermove", showTip)
    .on("pointerleave", hideTip)
    .on("pointerdown", showTip);

  nodeSel = enter.merge(nodeSel);

  nodeSel.transition().duration(instant ? 0 : 600)
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", d => Math.max(6, rScale(d.total)))
    .attr("fill", d => d.total === 0 ? "#bbb" : color(d.shelter))
    .attr("stroke", d => d.total === 0 ? "#888" : "none");

  labelSel = g.select(".labels")
    .selectAll("text")
    .data(frame.nodes, d => d.shelter);

  labelSel.exit().remove();

  labelSel.enter().append("text")
    .merge(labelSel)
    .attr("x", d => d.x)
    .attr("y", d => d.y + 4)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("opacity", 0.8)
    .text(d => d.shelter);
}

// scrollama
function setupScroller() {
  const scroller = scrollama();

  scroller.setup({
    step: "#steps .step",
    offset: window.innerWidth < 900 ? 0.8 : 0.6
  }).onStepEnter(resp => {
    const idx = +resp.element.dataset.index;
    if (cumulativePerPeriod[idx]) updatePeriod(idx);
  });

  window.addEventListener("resize", () => scroller.resize());
}

function onResize() {
  computeSize();
  computeShelterPositions();
  updatePeriod(currentIndex, true);
}

// tooltip
function showTip(event, d) {
  tooltipEl
    .style("opacity", 1)
    .style("left", event.clientX + 12 + "px")
    .style("top", event.clientY + 12 + "px")
    .html(`<strong>${d.shelter}</strong><br/>Cumulative: ${d.total}`);
}

function hideTip() {
  tooltipEl.style("opacity", 0);
}

function checkMobileBreakpoint() {
  isMobile = window.innerWidth < 900;
}


function initShelterGrid() {
  d3.csv("data/summary_by_category.csv").then(data => {
    const container = d3.select("#shelterGrid");

    // define cats, skip first column
    const categories = data.columns.slice(1);
    const color = d3.scaleOrdinal()
      .domain(categories)
      .range(d3.schemeTableau10.concat(d3.schemeSet2).slice(0, categories.length));

    const tooltip = d3.select("body").append("div").attr("class", "tooltip");

    data.forEach(d => {
      // transform row into key-value pairs
      const entries = categories.map(k => ({ key: k, value: +d[k] || 0 }));
      const total = d3.sum(entries, e => e.value);
      // skip empty shelters
      if (total === 0) return; 

      const card = container.append("div").attr("class", "shelter-card");
      const svg = card.append("svg").attr("viewBox", "0 0 120 120");
      const g = svg.append("g").attr("transform", "translate(60,60)");

      const pie = d3.pie()
        .sort(null)
        .value(e => e.value);

      const arc = d3.arc()
        .innerRadius(25)
        .outerRadius(55);

      const arcs = g.selectAll("path")
        .data(pie(entries))
        .join("path")
        .attr("fill", e => color(e.data.key))
        .attr("d", arc)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.8)
        .on("mousemove", (event, e) => {
          tooltip
            .style("opacity", 1)
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px")
            .html(`
              <strong>${d["Emergency Temporary Shelter"]}</strong><br/>
              ${e.data.key}: ${e.data.value.toLocaleString()}
            `);
        })
        .on("mouseout", () => tooltip.style("opacity", 0));

      // add label underneath
      card.append("div").attr("class", "shelter-name")
        .text(d["Emergency Temporary Shelter"]);
    });
  });
}

initShelterGrid();