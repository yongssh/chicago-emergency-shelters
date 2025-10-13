
const WIDTH = 900;
const HEIGHT = 620;

const MARGIN = { top: 30, right: 20, bottom: 30, left: 20 };
const INNER_W = WIDTH - MARGIN.left - MARGIN.right;
const INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom;

const svg = d3.select("#viz").attr("viewBox", [0, 0, WIDTH, HEIGHT]);
const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

const overlayEl = document.getElementById("overlay-period");
const legendEl = document.getElementById("legend");
const tooltipEl = d3.select("#tooltip");

const color = d3.scaleOrdinal(d3.schemeTableau10); // shelter color
const rScale = d3.scaleSqrt().range([4, 55]);      // bubble size (set domain after data load)

let simulation;

//!! sorted unique Date objects (Period Start)
let periods = [];                
//!! periodKey -> Map(shelter -> periodTotal)
let byPeriodShelter = new Map(); 
//!! TRACK: [{period, nodes:[{shelter,total}], periodSum, cumulativeSum}, ...]
let cumulativePerPeriod = [];   
//!! stable shelter list for labeling/consistent color
let sheltersList = [];          

const parseDate = (s) => s ? new Date(s) : null;
const fShort = d3.timeFormat("%b %d, %Y");
const fMonth = d3.timeFormat("%b %Y");

d3.csv("data/grievances.csv").then(raw => {
  // normalize
  const rows = raw
    .map(d => ({
      shelter: d["Emergency Temporary Shelter"]?.trim(),
      start: parseDate(d["Period Start"]),
      end: parseDate(d["Period End"]),
      total: +d["Total"] || 0
    }))
    .filter(d => d.shelter && d.start && Number.isFinite(d.total));

  // unique periods (Period Start) sorted
  periods = Array.from(new Set(rows.map(d => +d.start))).sort((a, b) => a - b).map(t => new Date(t));

  // per-period totals per shelter
  byPeriodShelter = new Map();
  for (const p of periods) {
    const key = +p;
    const map = new Map();
    rows.filter(r => +r.start === key).forEach(r => {
      map.set(r.shelter, (map.get(r.shelter) || 0) + r.total);
    });
    byPeriodShelter.set(key, map);
  }

  // 4) Cumulative per shelter over time
  const running = new Map(); // shelter -> cumulative
  sheltersList = Array.from(new Set(rows.map(r => r.shelter))).sort();
  const periodFrames = [];

  let grandRunning = 0;
  for (const p of periods) {
    const key = +p;
    const map = byPeriodShelter.get(key) || new Map();

    // add period totals to running cumulative
    let periodSum = 0;
    map.forEach((v, s) => {
      running.set(s, (running.get(s) || 0) + v);
      periodSum += v;
    });
    grandRunning += periodSum;

    //! TODO include Daley College (even if total = 0)
    const nodes = sheltersList
      .map(s => ({ shelter: s, total: running.get(s) || 0 }))
      .filter(d => d.total > 0 || d.shelter === "Daley College");

    periodFrames.push({ period: p, nodes, periodSum, cumulativeSum: grandRunning });
  }
  cumulativePerPeriod = periodFrames;

  rScale.domain([0, d3.max(cumulativePerPeriod, f => d3.max(f.nodes, n => n.total) || 0) || 1]);

  buildSteps(cumulativePerPeriod);

  initScene();

  setupScroller();
});


/* step DOM from data */
function buildSteps(frames) {
  const steps = d3.select("#steps");
  const sel = steps.selectAll(".step")
    .data(frames)
    .join("div")
    .attr("class", "step")
    .attr("data-index", (_, i) => i);

  sel.append("h3")
    .text(d => `${fShort(d.period)} — ${d.periodSum} grievances this period`);

  sel.append("p")
    .text(d => `Total grievances thus far: ${d.cumulativeSum}`);

  //! TODO: add Daley College note
  legendEl.innerHTML = `
    <div><strong>Bubble:</strong> Shelter</div>
    <div><strong>Size:</strong> Cumulative grievances up to the shown period</div>
    <div>Hover a bubble for details</div>
    <hr style="border: none; border-top: 1px solid #ddd; margin: 6px 0;" />
    <div style="font-size: 0.85rem; color: #555;">
      <em>Note:</em> Daley College did not record any grievances during this period,
      but is shown here as a gray bubble to indicate its operation and closure in July 2024.
    </div>
  `;
}


/* Visualization scene  */
let nodeSel, labelSel; 

function initScene() {
  // SVG groups
  g.append("g").attr("class", "nodes");
  g.append("g").attr("class", "labels");

  // static shelter positions 
  // Create a grid layout 
  const cols = 6; 
  const spacingX = INNER_W / (cols + 1);
  const spacingY = INNER_H / Math.ceil(sheltersList.length / cols + 1);
  const startX = spacingX;
  const startY = spacingY;

  // map shelter name to static coordinates (want them to appear in the same place so can accumulate)
  shelterPositions = new Map();
  sheltersList.forEach((shelter, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * spacingX;
    const y = startY + row * spacingY;
    shelterPositions.set(shelter, { x, y });
  });

  // initialize empty selections
  nodeSel = g.select(".nodes").selectAll("circle");
  labelSel = g.select(".labels").selectAll("text");

  // start at first period
  updatePeriod(0, true);
}

function ticked() {
  nodeSel
    .attr("cx", d => d.x)
    .attr("cy", d => d.y);

  labelSel
    .attr("x", d => d.x)
    .attr("y", d => d.y + 4);
}


/* Update to a given period  */
function updatePeriod(index, instant = false) {
  const frame = cumulativePerPeriod[index];
  if (!frame) return;

  overlayEl.textContent = `Period: ${fShort(frame.period)} (biweekly)`;

  // use fixed positions from shelterPositions
  frame.nodes.forEach(d => {
    const pos = shelterPositions.get(d.shelter);
    d.x = pos.x;
    d.y = pos.y;
  });

  // JOIN: nodes
  nodeSel = g.select(".nodes").selectAll("circle")
    .data(frame.nodes, d => d.shelter);

  // EXIT
  nodeSel.exit()
    .transition().duration(instant ? 0 : 400)
    .attr("opacity", 0)
    .attr("r", 0)
    .remove();

  // ENTER
  const nodeEnter = nodeSel.enter().append("circle")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", 0)
    .attr("fill", d => color(d.shelter))
    .attr("opacity", 0)
    .on("mousemove", (event, d) => showTip(event, d))
    .on("mouseout", hideTip);

  // MERGE + UPDATE
  nodeSel = nodeEnter.merge(nodeSel);

  nodeSel.transition().duration(instant ? 0 : 800).ease(d3.easeCubicInOut)
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", d => Math.max(6, rScale(d.total))) // give Daley a small dot
    .attr("fill", d => d.total === 0 ? "#bbb" : color(d.shelter))
    .attr("stroke", d => d.total === 0 ? "#888" : "none")
    .attr("stroke-width", d => d.total === 0 ? 1 : 0)
    .attr("opacity", d => d.total === 0 ? 0.6 : 0.9);


  // Labels
  labelSel = g.select(".labels").selectAll("text")
    .data(frame.nodes, d => d.shelter);

  labelSel.exit()
    .transition().duration(instant ? 0 : 300)
    .attr("opacity", 0)
    .remove();

  const lblEnter = labelSel.enter().append("text")
    .attr("x", d => d.x)
    .attr("y", d => d.y + 4)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", "#444")
    .attr("opacity", 0)
    .text(d => d.shelter);

  labelSel = lblEnter.merge(labelSel);
  labelSel.transition().duration(instant ? 0 : 500).attr("opacity", 0.85);
}



/* Scrollama wiring */
function setupScroller() {
  const scroller = scrollama();

  scroller.setup({
    step: "#steps .step",
    offset: 0.6,
    progress: true
  })
    .onStepEnter((resp) => {
      // grab period index from HTML data attribute
      const idx = +resp.element.dataset.index;

      // only update if that index exists in cumulativePerPeriod array
      if (cumulativePerPeriod[idx]) {
        updatePeriod(idx);
      }
    });


  window.addEventListener("resize", () => scroller.resize());
}


/* Tooltip helpers */
function showTip(event, d) {
  tooltipEl
    .style("opacity", 1)
    .style("left", (event.pageX) + "px")
    .style("top", (event.pageY - 10) + "px")
    .attr("aria-hidden", "false")
    .html(`<strong>${d.shelter}</strong><br/>Cumulative grievances: ${d.total}`);
}
function hideTip() {
  tooltipEl.style("opacity", 0).attr("aria-hidden", "true");
}
/* Shelter Grid Breakdown */

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
