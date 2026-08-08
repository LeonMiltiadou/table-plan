/* Table Plan — a small seating-plan editor.
   No build step, no server, no dependencies. State lives in localStorage
   and travels as a plain JSON file. */
"use strict";

// ── Constants ───────────────────────────────────────────────
const STORE = "table-plan.state.v1";
const THEME = "table-plan.theme";

const D = 118;          // half-diagonal of a diamond table
const SEAT_OUT = 24;    // chair centres, measured out from the table edge
const NAME_OUT = 38;    // name anchors, outside the chairs
const RT = Math.SQRT1_2;
const MAX_PER_SIDE = 3;
const GRID = 10;        // tables snap to this while dragging
const PAD = 60;         // breathing room around the outermost label
const NAME_W = 190;     // roughly how wide a "Surname Firstname" label runs

const SIDE_KEYS = ["ne", "se", "sw", "nw"];
const SIDE_LABEL = { ne: "Top right", se: "Bottom right", sw: "Bottom left", nw: "Top left" };
// Geometry of each run, walking clockwise from the top corner.
const SIDE_GEOM = {
  ne: { a: [0, -D], b: [D, 0],  n: [ RT, -RT], anchor: "start" },
  se: { a: [D, 0],  b: [0, D],  n: [ RT,  RT], anchor: "start" },
  sw: { a: [0, D],  b: [-D, 0], n: [-RT,  RT], anchor: "end" },
  nw: { a: [-D, 0], b: [0, -D], n: [-RT, -RT], anchor: "end" },
};

const DIETS = ["vegan", "vegetarian", "pescatarian"];
const DIET_LABEL = { vegan: "Vegan", vegetarian: "Vegetarian", pescatarian: "Pescatarian" };

const PALETTES = {
  dark:  { paper: "#14110d", table: "#1c1813", edge: "#d8b26a", ink: "#f0e9dd", dim: "#a4998a",
           faint: "#6f6558", chair: "#3a352c", chairEdge: "#4a4437", warn: "#e8b53f", drop: "#4ad6a0",
           vegan: "#6d8fe8", vegetarian: "#4bb8e8", pescatarian: "#c98fd6", other: "#8d7a5e" },
  light: { paper: "#ffffff", table: "#faf7f1", edge: "#9a742a", ink: "#241f18", dim: "#6b6155",
           faint: "#93897a", chair: "#e6ded0", chairEdge: "#c3b79f", warn: "#a97405", drop: "#127f5b",
           vegan: "#2f4fbe", vegetarian: "#0d7fae", pescatarian: "#8e3fa4", other: "#7a6543" },
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = p => p + "-" + Math.random().toString(36).slice(2, 9);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── State ───────────────────────────────────────────────────
let state = null;
let selectedTable = null;    // table id
let selectedPerson = null;   // { guestId, tableId|null, seat|null }
const undoStack = [];
let snapshot = "";

function seatTotal(t) {
  return t.kind === "rect" ? t.seats : SIDE_KEYS.reduce((n, k) => n + (t.sides[k] || 0), 0);
}

function normalise(plan) {
  const p = {
    name: typeof plan.name === "string" ? plan.name : "Table plan",
    guests: [], tables: [], seating: {},
  };

  for (const g of plan.guests || []) {
    if (!g || (!g.first && !g.last)) continue;
    p.guests.push({
      id: g.id || uid("g"),
      first: String(g.first || ""), last: String(g.last || ""),
      diet: g.diet || null, allergy: g.allergy || null,
    });
  }

  for (const t of plan.tables || []) {
    const kind = t.kind === "rect" ? "rect" : "diamond";
    const table = {
      id: t.id || uid("t"), name: String(t.name || "Table"), kind,
      x: Number(t.x) || 0, y: Number(t.y) || 0, angle: Number(t.angle) || 0,
    };
    if (kind === "rect") {
      table.seats = clamp(Math.round(Number(t.seats) || 8), 1, 14);
    } else {
      table.sides = {};
      for (const k of SIDE_KEYS) {
        table.sides[k] = clamp(Math.round(Number(t.sides?.[k] ?? 2)), 0, MAX_PER_SIDE);
      }
    }
    p.tables.push(table);
  }

  // Rebuild seating so it always matches the chairs that actually exist,
  // and so nobody can be seated twice.
  const known = new Set(p.guests.map(g => g.id));
  const used = new Set();
  for (const t of p.tables) {
    const row = Array.from({ length: seatTotal(t) }, () => null);
    const saved = plan.seating?.[t.id] || [];
    for (let i = 0; i < row.length; i++) {
      const id = saved[i];
      if (id && known.has(id) && !used.has(id)) { row[i] = id; used.add(id); }
    }
    p.seating[t.id] = row;
  }
  return p;
}

const unseated = () => {
  const seated = new Set(Object.values(state.seating).flat().filter(Boolean));
  return state.guests.filter(g => !seated.has(g.id));
};
const guestById = id => state.guests.find(g => g.id === id) || null;
const tableById = id => state.tables.find(t => t.id === id) || null;

// ── Persistence ─────────────────────────────────────────────
let saveTimer;
function commit(pushUndo = true) {
  if (pushUndo) {
    undoStack.push(snapshot);
    if (undoStack.length > 60) undoStack.shift();
    $("undo").disabled = false;
  }
  snapshot = JSON.stringify(state);
  clearTimeout(saveTimer);
  setStatus("Saving…");
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, snapshot); setStatus("Saved"); }
    catch { setStatus("Not saved"); }
  }, 200);
}
const setStatus = t => { $("status").textContent = t; };

// Opening a different plan replaces everything, so there is nothing sensible to
// step back into — clear the history rather than let Undo wipe what was loaded.
function resetHistory() {
  undoStack.length = 0;
  $("undo").disabled = true;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return normalise(JSON.parse(raw));
  } catch { /* fall through to the bundled plan */ }
  return normalise(window.DEFAULT_PLAN || { name: "Table plan", guests: [], tables: [] });
}

// ── Geometry ────────────────────────────────────────────────
function rot(x, y, deg) {
  if (!deg) return [x, y];
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

// Every chair on a table: where it sits and where its name hangs.
function seatGeometry(t) {
  const out = [];
  const push = (lx, ly, nx, ny, anchor, stacked) => {
    const [rx, ry] = rot(lx, ly, t.angle);
    const [ax, ay] = rot(nx, ny, t.angle);
    out.push({ x: t.x + rx, y: t.y + ry, tx: t.x + ax, ty: t.y + ay, anchor, stacked });
  };

  if (t.kind === "rect") {
    const { len, depth } = rectSize(t);
    const step = len / t.seats;
    for (let i = 0; i < t.seats; i++) {
      // Chair 1 sits at the far end, so the run reads the same way round as the plan.
      const cx = len / 2 - step * (i + 0.5);
      push(cx, -depth / 2 - SEAT_OUT, cx, -depth / 2 - NAME_OUT, "middle", true);
    }
    return out;
  }

  for (const k of SIDE_KEYS) {
    const count = t.sides[k] || 0;
    const s = SIDE_GEOM[k];
    for (let i = 0; i < count; i++) {
      const f = (i + 0.5) / count;
      const bx = s.a[0] + (s.b[0] - s.a[0]) * f;
      const by = s.a[1] + (s.b[1] - s.a[1]) * f;
      push(bx + s.n[0] * SEAT_OUT, by + s.n[1] * SEAT_OUT,
           bx + s.n[0] * NAME_OUT + (s.anchor === "start" ? 6 : -6),
           by + s.n[1] * NAME_OUT, s.anchor, false);
    }
  }
  return out;
}

function rectSize(t) {
  return { len: Math.max(240, t.seats * 95), depth: 112 };
}

// Bounds of the plan itself: used to fit the view and to frame exports.
// Measured from the real chair and label positions, so a fit has no dead space.
function contentBox() {
  if (!state.tables.length) return { x: 0, y: 0, w: 1200, h: 800 };
  const xs = [], ys = [];
  const add = (x, y) => { xs.push(x); ys.push(y); };

  for (const t of state.tables) {
    // Table outline
    if (t.kind === "rect") {
      const { len, depth } = rectSize(t);
      for (const [lx, ly] of [[-len / 2, -depth / 2], [len / 2, -depth / 2], [len / 2, depth / 2], [-len / 2, depth / 2]]) {
        const [rx, ry] = rot(lx, ly, t.angle);
        add(t.x + rx, t.y + ry);
      }
    } else {
      for (const [lx, ly] of [[0, -D], [D, 0], [0, D], [-D, 0]]) {
        const [rx, ry] = rot(lx, ly, t.angle);
        add(t.x + rx, t.y + ry);
      }
    }
    // Chairs and the room their names take up
    for (const s of seatGeometry(t)) {
      add(s.x, s.y);
      if (s.anchor === "start") add(s.tx + NAME_W, s.ty);
      else if (s.anchor === "end") add(s.tx - NAME_W, s.ty);
      else { add(s.tx - 60, s.ty - 26); add(s.tx + 60, s.ty + 10); }
      add(s.tx, s.ty);
    }
  }

  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX - PAD, y: minY - PAD, w: (maxX - minX) + PAD * 2, h: (maxY - minY) + PAD * 2 };
}

// ── Plan styles (shared by the page and by exported pictures) ─
function planCss(p) {
  return `
    .paper { fill: ${p.paper}; }
    .tshape { fill: ${p.table}; stroke: ${p.edge}; stroke-width: 2; cursor: grab; }
    .tshape.sel { stroke-width: 4; }
    .ttitle { fill: ${p.edge}; font-weight: 700; letter-spacing: .12em; pointer-events: none; }
    .tmeta { fill: ${p.faint}; letter-spacing: .1em; pointer-events: none; }
    .chair { fill: ${p.chair}; stroke: ${p.chairEdge}; stroke-width: 1.5; }
    .chair.vegan { fill: ${p.vegan}; stroke: ${p.vegan}; }
    .chair.vegetarian { fill: ${p.vegetarian}; stroke: ${p.vegetarian}; }
    .chair.pescatarian { fill: ${p.pescatarian}; stroke: ${p.pescatarian}; }
    .chair.other { fill: ${p.other}; stroke: ${p.other}; }
    .chair.free { fill: none; stroke: ${p.chairEdge}; stroke-dasharray: 3 3; }
    .ring { fill: none; stroke: ${p.warn}; stroke-width: 3; }
    .nm { font-size: 18px; fill: ${p.ink}; pointer-events: none; }
    .nm .gv { fill: ${p.dim}; }
    .seat { cursor: grab; }
    .hit { fill: transparent; }
    .seat.lift .nm { font-weight: 700; }
    .seat.lift .chair { stroke: ${p.edge}; stroke-width: 3; }
    .seat.target .chair { stroke: ${p.drop}; stroke-width: 4; }
    .seat.target .nm { fill: ${p.drop}; }
    .seat.picked .chair { stroke: ${p.edge}; stroke-width: 4; }
    text { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  `;
}

// ── Drawing ─────────────────────────────────────────────────
function tableSvg(t, opts = {}) {
  const row = state.seating[t.id] || [];
  const geo = seatGeometry(t);
  const filled = row.filter(Boolean).length;
  const flagged = row.filter(id => id && (guestById(id)?.diet || guestById(id)?.allergy)).length;
  const selected = !opts.forExport && t.id === selectedTable;

  const shape = t.kind === "rect"
    ? (() => {
        const { len, depth } = rectSize(t);
        return `<rect class="tshape${selected ? " sel" : ""}" x="${-len / 2}" y="${-depth / 2}"
                 width="${len}" height="${depth}" rx="8"
                 transform="translate(${t.x} ${t.y}) rotate(${t.angle})"/>`;
      })()
    : `<rect class="tshape${selected ? " sel" : ""}" x="${-D * RT}" y="${-D * RT}"
         width="${(D * 2 * RT).toFixed(1)}" height="${(D * 2 * RT).toFixed(1)}" rx="6"
         transform="translate(${t.x} ${t.y}) rotate(${45 + t.angle})"/>`;

  const meta = filled ? `${filled} seated${flagged ? ` · ${flagged} to brief` : ""}` : `${seatTotal(t)} chairs`;
  const title = `
    <text x="${t.x}" y="${t.y + 2}" text-anchor="middle" class="ttitle" font-size="22">${esc(t.name).toUpperCase()}</text>
    <text x="${t.x}" y="${t.y + 24}" text-anchor="middle" class="tmeta" font-size="11">${esc(meta).toUpperCase()}</text>`;

  const seats = geo.map((s, i) => {
    const g = row[i] ? guestById(row[i]) : null;
    const cls = g ? (g.diet ? (DIETS.includes(g.diet) ? g.diet : "other") : "") : "free";
    const picked = !opts.forExport && selectedPerson && selectedPerson.tableId === t.id && selectedPerson.seat === i;

    let label = "";
    if (g && s.stacked) {
      label = `<text x="${s.tx.toFixed(1)}" y="${(s.ty - 8).toFixed(1)}" text-anchor="middle" class="nm" font-size="15">${esc(g.last)}</text>
               <text x="${s.tx.toFixed(1)}" y="${(s.ty + 7).toFixed(1)}" text-anchor="middle" class="nm gv" font-size="14" fill="inherit">${esc(g.first)}</text>`;
    } else if (g) {
      label = `<text x="${s.tx.toFixed(1)}" y="${(s.y + 6).toFixed(1)}" text-anchor="${s.anchor}" class="nm">${esc(g.last)} <tspan class="gv">${esc(g.first)}</tspan></text>`;
    }

    const hitX = s.anchor === "start" ? s.x - 16 : s.anchor === "end" ? s.x - 214 : s.x - 60;
    const hitY = s.stacked ? Math.min(s.y, s.ty) - 22 : s.y - 17;
    const hitW = s.anchor === "middle" ? 120 : 230;
    const hitH = s.stacked ? Math.abs(s.y - s.ty) + 44 : 34;

    return `<g class="seat${picked ? " picked" : ""}" data-table="${t.id}" data-seat="${i}">
        <rect class="hit" x="${hitX.toFixed(1)}" y="${hitY.toFixed(1)}" width="${hitW}" height="${hitH}"/>
        <circle class="chair ${cls}" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="9"/>
        ${g && g.allergy ? `<circle class="ring" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="13"/>` : ""}
        ${label}
      </g>`;
  }).join("");

  return `<g class="tg" data-table="${t.id}">${shape}${title}${seats}</g>`;
}

function planSvgInner(opts = {}) {
  const vb = contentBox();
  const palette = PALETTES[opts.theme || currentTheme()];
  // Only exported pictures paint their own background; on screen the stage
  // supplies it, so panning never runs off the edge of a drawn rectangle.
  const paper = opts.forExport
    ? `<rect class="paper" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}"/>`
    : "";
  return {
    vb,
    inner: `<style>${planCss(palette)}</style>${paper}${state.tables.map(t => tableSvg(t, opts)).join("")}`,
  };
}

const plan = $("plan");

function drawPlan() {
  plan.innerHTML = planSvgInner().inner;
  applyView();
}

// ── View: pan and zoom ──────────────────────────────────────
const MIN_SCALE = 0.08, MAX_SCALE = 4;
const VIEW_KEY = "table-plan.view";
let view = null;                 // { cx, cy, scale } in plan coordinates
let stageW = 900, stageH = 600;

function measureStage() {
  const r = $("stage").getBoundingClientRect();
  if (r.width > 20 && r.height > 20) { stageW = r.width; stageH = r.height; }
}

function applyView() {
  if (!view) return;
  const w = stageW / view.scale, h = stageH / view.scale;
  plan.setAttribute("viewBox", `${view.cx - w / 2} ${view.cy - h / 2} ${w} ${h}`);
  $("zoom-level").textContent = Math.round(view.scale * 100) + "%";
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {}
}

// Frame the whole plan with a little room to spare.
function fitView() {
  measureStage();
  const b = contentBox();
  const scale = clamp(Math.min(stageW / b.w, stageH / b.h) * 0.96, MIN_SCALE, MAX_SCALE);
  view = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, scale };
  applyView();
}

function zoomBy(factor, clientX, clientY) {
  if (!view) return;
  const anchor = (clientX == null)
    ? { x: view.cx, y: view.cy }
    : clientToPlan(clientX, clientY);
  const next = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  if (next === view.scale) return;
  // Keep whatever is under the cursor pinned in place.
  const k = 1 - view.scale / next;
  view.cx += (anchor.x - view.cx) * k;
  view.cy += (anchor.y - view.cy) * k;
  view.scale = next;
  applyView();
}

function clientToPlan(clientX, clientY) {
  const pt = plan.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(plan.getScreenCTM().inverse());
}

$("zoom-in").onclick = () => zoomBy(1.25);
$("zoom-out").onclick = () => zoomBy(1 / 1.25);
$("zoom-level").onclick = () => fitView();

plan.addEventListener("wheel", e => {
  e.preventDefault();
  zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY);
}, { passive: false });

new ResizeObserver(() => { measureStage(); applyView(); }).observe($("stage"));

// ── Side panels ─────────────────────────────────────────────
// Split apart so a live slider drag can refresh the plan and the lists
// without rebuilding the very control being dragged.
function drawUnseated() {
  const free = unseated();
  $("unseated-count").textContent = free.length;
  $("unseated").innerHTML = free.length
    ? free.map(g => `<li data-guest="${g.id}"${selectedPerson && !selectedPerson.tableId && selectedPerson.guestId === g.id ? ' class="sel"' : ""}>${esc(g.last)} <span class="given">${esc(g.first)}</span></li>`).join("")
    : `<li class="empty">Everyone has a seat.</li>`;
}

function drawPerson() {
  const pc = $("person-card");
  if (selectedPerson && selectedPerson.tableId) {
    const g = guestById(selectedPerson.guestId);
    pc.hidden = false;
    $("person-name").innerHTML = g ? `${esc(g.last)} <span class="given">${esc(g.first)}</span>` : "";
  } else {
    pc.hidden = true;
  }
}

// A slider and its number box always show the same value.
function setPair(base, value) {
  const r = $(base + "-range"), n = $(base + "-num");
  if (r) r.value = value;
  if (n) n.value = value;
}

function drawTableCard() {
  const t = tableById(selectedTable);
  const card = $("table-card");
  if (!t) { card.hidden = true; return; }
  card.hidden = false;
  $("t-name").value = t.name;
  setPair("t-angle", t.angle);
  $("diamond-controls").hidden = t.kind !== "diamond";
  $("rect-controls").hidden = t.kind !== "rect";

  if (t.kind === "rect") {
    setPair("t-seats", t.seats);
  } else {
    $("sides").innerHTML = SIDE_KEYS.map(k => `
      <div class="ctl">
        <label for="side-${k}-num">${SIDE_LABEL[k]}</label>
        <input id="side-${k}-range" type="range" min="0" max="${MAX_PER_SIDE}" step="1" value="${t.sides[k]}" data-side="${k}">
        <input id="side-${k}-num" type="number" min="0" max="${MAX_PER_SIDE}" step="1" value="${t.sides[k]}" data-side="${k}">
      </div>`).join("");
  }
}

function drawPanels() {
  $("plan-name").value = state.name;
  drawUnseated();
  drawPerson();
  drawTableCard();
  drawNotes();
}

function drawNotes() {
  // Food notes
  const notes = [];
  for (const tb of state.tables) {
    (state.seating[tb.id] || []).forEach(id => {
      const g = id && guestById(id);
      if (g && (g.diet || g.allergy)) notes.push({ g, table: tb.name });
    });
  }
  for (const g of unseated()) if (g.diet || g.allergy) notes.push({ g, table: "Unseated" });
  $("diet-notes").innerHTML = notes.length
    ? notes.map(({ g, table }) => `<li><b>${esc(g.last)} ${esc(g.first)}</b> — ${esc(table)}${
        g.diet ? " · " + esc(DIET_LABEL[g.diet] || g.diet) : ""}${
        g.allergy ? ` · <span class="warn">${esc(g.allergy)}</span>` : ""}</li>`).join("")
    : `<li>No dietary notes.</li>`;
}

const render = () => { drawPlan(); drawPanels(); };

// ── Seating moves ───────────────────────────────────────────
function place(guestId, tableId, seat) {
  // Lift the guest out of wherever they are now.
  for (const row of Object.values(state.seating)) {
    const i = row.indexOf(guestId);
    if (i > -1) row[i] = null;
  }
  const row = state.seating[tableId];
  const displaced = row[seat];
  row[seat] = guestId;
  return displaced || null;   // displaced guest becomes unseated
}

function swap(aTable, aSeat, bTable, bSeat) {
  const A = state.seating[aTable], B = state.seating[bTable];
  const tmp = A[aSeat]; A[aSeat] = B[bSeat]; B[bSeat] = tmp;
}

// ── Dragging on the plan ────────────────────────────────────
const THRESHOLD = 4;
let drag = null;

function toSvg(evt) {
  const pt = plan.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(plan.getScreenCTM().inverse());
}

function nearestSeat(x, y, skip) {
  let best = null, bestD = 95;
  for (const t of state.tables) {
    seatGeometry(t).forEach((s, i) => {
      if (skip && skip.tid === t.id && skip.idx === i) return;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = { tid: t.id, idx: i }; }
    });
  }
  return best;
}
const seatNode = ref => plan.querySelector(`.seat[data-table="${ref.tid}"][data-seat="${ref.idx}"]`);

plan.addEventListener("pointerdown", e => {
  const seatEl = e.target.closest(".seat");
  const tableEl = e.target.closest(".tg");

  if (!tableEl) {                       // empty background: pan the view
    drag = { kind: "pan", startX: e.clientX, startY: e.clientY, cx: view.cx, cy: view.cy, moved: false };
    plan.classList.add("panning");
    try { plan.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
    return;
  }

  const start = toSvg(e);

  if (seatEl) {
    const tid = seatEl.dataset.table, idx = +seatEl.dataset.seat;
    drag = { kind: "seat", el: seatEl, tid, idx, start, moved: false, target: null,
             occupied: !!state.seating[tid][idx] };
  } else {
    const t = tableById(tableEl.dataset.table);
    drag = { kind: "table", el: tableEl, tid: t.id, start, moved: false, ox: t.x, oy: t.y };
  }
  try { plan.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
  e.preventDefault();
});

plan.addEventListener("pointermove", e => {
  if (!drag) return;

  if (drag.kind === "pan") {
    drag.moved = true;
    view.cx = drag.cx - (e.clientX - drag.startX) / view.scale;
    view.cy = drag.cy - (e.clientY - drag.startY) / view.scale;
    applyView();
    return;
  }

  const p = toSvg(e);
  const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (!drag.moved && Math.hypot(dx, dy) < THRESHOLD) return;
  if (!drag.moved) {
    if (drag.kind === "seat" && !drag.occupied) { drag = null; return; }  // nothing to carry
    drag.moved = true;
    drag.el.classList.add("lift");
    if (drag.kind === "seat") plan.appendChild(drag.el);
  }
  drag.el.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);

  if (drag.kind === "seat") {
    const hit = nearestSeat(p.x, p.y, { tid: drag.tid, idx: drag.idx });
    const same = hit && drag.target && hit.tid === drag.target.tid && hit.idx === drag.target.idx;
    if (!same) {
      if (drag.target) seatNode(drag.target)?.classList.remove("target");
      drag.target = hit;
      if (hit) seatNode(hit)?.classList.add("target");
    }
  }
});

plan.addEventListener("pointerup", e => {
  if (!drag) return;
  const d = drag; drag = null;
  try { plan.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

  if (d.kind === "pan") {
    plan.classList.remove("panning");
    if (!d.moved) { selectedTable = null; selectedPerson = null; render(); }
    return;
  }

  if (!d.moved) {                       // a click, not a drag
    d.el.removeAttribute("transform");
    if (d.kind === "seat") clickSeat(d.tid, d.idx);
    else { selectedTable = d.tid; selectedPerson = null; render(); }
    return;
  }

  if (d.kind === "table") {
    const p = toSvg(e);
    const t = tableById(d.tid);
    t.x = Math.round((d.ox + (p.x - d.start.x)) / GRID) * GRID;
    t.y = Math.round((d.oy + (p.y - d.start.y)) / GRID) * GRID;
    selectedTable = t.id;
    commit();
  } else if (d.target) {
    swap(d.tid, d.idx, d.target.tid, d.target.idx);
    commit();
  }
  render();
});

plan.addEventListener("pointercancel", () => {
  if (!drag) return;
  drag = null; plan.classList.remove("panning"); render();
});

// Click a chair: seat the person you picked, or select whoever is sitting there.
function clickSeat(tid, idx) {
  const sitting = state.seating[tid][idx];
  if (selectedPerson && !selectedPerson.tableId) {          // placing from the Unseated list
    place(selectedPerson.guestId, tid, idx);
    selectedPerson = null;
    commit();
  } else if (selectedPerson && selectedPerson.tableId) {    // move the selected person here
    if (selectedPerson.tableId === tid && selectedPerson.seat === idx) selectedPerson = null;
    else { place(selectedPerson.guestId, tid, idx); selectedPerson = null; commit(); }
  } else if (sitting) {
    selectedPerson = { guestId: sitting, tableId: tid, seat: idx };
  }
  selectedTable = null;
  render();
}

// ── Sidebar wiring ──────────────────────────────────────────
$("unseated").addEventListener("click", e => {
  const li = e.target.closest("li[data-guest]");
  if (!li) return;
  const id = li.dataset.guest;
  selectedPerson = (selectedPerson && selectedPerson.guestId === id && !selectedPerson.tableId)
    ? null : { guestId: id, tableId: null, seat: null };
  selectedTable = null;
  render();
});

$("unseat").onclick = () => {
  if (!selectedPerson || !selectedPerson.tableId) return;
  state.seating[selectedPerson.tableId][selectedPerson.seat] = null;
  selectedPerson = null;
  commit(); render();
};

$("add-guest").onclick = () => {
  const raw = $("new-guest").value.trim();
  if (!raw) return;
  const [last, first] = raw.includes(",") ? raw.split(",", 2).map(s => s.trim())
                                          : [raw.split(" ").slice(-1)[0], raw.split(" ").slice(0, -1).join(" ")];
  state.guests.push({ id: uid("g"), first: first || "", last: last || raw, diet: null, allergy: null });
  $("new-guest").value = "";
  commit(); render();
};
$("new-guest").addEventListener("keydown", e => { if (e.key === "Enter") $("add-guest").click(); });

$("plan-name").addEventListener("change", e => { state.name = e.target.value.trim() || "Table plan"; commit(); });

$("t-name").addEventListener("input", e => {
  const t = tableById(selectedTable); if (!t) return;
  t.name = e.target.value; drawPlan();
});
$("t-name").addEventListener("change", () => commit());

// Both halves of a pair drive the same value: live feedback while you drag or
// type, and a single undo step once the interaction finishes.
function bindPair(base, onLive, onDone) {
  for (const el of [$(base + "-range"), $(base + "-num")]) {
    el.addEventListener("input", e => {
      const raw = Math.round(+e.target.value);
      if (!Number.isFinite(raw)) return;              // mid-typing, e.g. "-"
      const v = clamp(raw, +e.target.min, +e.target.max);
      setPair(base, v);
      onLive(v);
    });
    el.addEventListener("change", e => {
      const v = clamp(Math.round(+e.target.value) || 0, +e.target.min, +e.target.max);
      setPair(base, v);
      onDone(v);
    });
  }
}

bindPair("t-angle",
  v => { const t = tableById(selectedTable); if (t) { t.angle = v; drawPlan(); } },
  v => { const t = tableById(selectedTable); if (t) { t.angle = v; drawPlan(); commit(); } });

bindPair("t-seats",
  v => { const t = tableById(selectedTable); if (t?.kind === "rect") reseat(t, () => { t.seats = v; }, false); },
  v => { const t = tableById(selectedTable); if (t?.kind === "rect") reseat(t, () => { t.seats = v; }, true); });

// The four side controls are rebuilt with the panel, so delegate to them.
for (const evt of ["input", "change"]) {
  $("sides").addEventListener(evt, e => {
    const el = e.target.closest("[data-side]"); if (!el) return;
    const t = tableById(selectedTable); if (!t || t.kind !== "diamond") return;
    const k = el.dataset.side;
    const raw = Math.round(+el.value);
    if (!Number.isFinite(raw)) return;
    const v = clamp(raw, 0, MAX_PER_SIDE);
    setPair(`side-${k}`, v);
    reseat(t, () => { t.sides[k] = v; }, evt === "change");
  });
}

// Change a table's chairs, keeping whoever still fits; the rest go to Unseated.
function reseat(t, mutate, done) {
  const people = state.seating[t.id].filter(Boolean);
  mutate();
  const row = Array.from({ length: seatTotal(t) }, () => null);
  for (let i = 0; i < row.length && i < people.length; i++) row[i] = people[i];
  state.seating[t.id] = row;
  drawPlan(); drawUnseated(); drawNotes();
  if (done) commit();
}

$("t-delete").onclick = () => {
  const t = tableById(selectedTable); if (!t) return;
  const n = state.seating[t.id].filter(Boolean).length;
  if (!confirm(`Delete "${t.name}"?${n ? ` ${n} ${n === 1 ? "person goes" : "people go"} back to Unseated.` : ""}`)) return;
  state.tables = state.tables.filter(x => x.id !== t.id);
  delete state.seating[t.id];
  selectedTable = null;
  commit(); render();
};

function addTable(kind) {
  // Drop it just right of the rightmost table so it never lands underneath one.
  const x = state.tables.length ? Math.max(...state.tables.map(t => t.x)) + 360 : 400;
  const y = state.tables.length ? state.tables[state.tables.length - 1].y : 400;
  const t = kind === "rect"
    ? { id: uid("t"), name: "Long table", kind: "rect", x, y, angle: 0, seats: 8 }
    : { id: uid("t"), name: "New table", kind: "diamond", x, y, angle: 0, sides: { ne: 2, se: 3, sw: 2, nw: 3 } };
  state.tables.push(t);
  state.seating[t.id] = Array.from({ length: seatTotal(t) }, () => null);
  selectedTable = t.id; selectedPerson = null;
  commit(); render();
}
$("add-diamond").onclick = () => { closeMenus(); addTable("diamond"); };
$("add-rect").onclick = () => { closeMenus(); addTable("rect"); };

// ── Undo ────────────────────────────────────────────────────
$("undo").disabled = true;
$("undo").onclick = () => {
  const prev = undoStack.pop();
  if (!prev) return;
  state = normalise(JSON.parse(prev));
  $("undo").disabled = undoStack.length === 0;
  selectedTable = null; selectedPerson = null;
  commit(false); render();
};
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $("undo").click(); }
  if (e.key === "Escape") { selectedPerson = null; selectedTable = null; render(); }
});

// ── Theme ───────────────────────────────────────────────────
const currentTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
$("theme").onclick = () => {
  const light = currentTheme() === "light";
  document.documentElement.dataset.theme = light ? "" : "light";
  $("theme").textContent = light ? "Light" : "Dark";
  try { localStorage.setItem(THEME, light ? "" : "light"); } catch {}
  drawPlan();
};

// ── Import / export ─────────────────────────────────────────
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = () => (state.name || "table-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function exportJson() {
  download(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), `${slug()}.json`);
}

function exportCsv() {
  const rows = [["Surname", "First name", "Table", "Chair", "Dietary", "Allergies"]];
  for (const t of state.tables) {
    (state.seating[t.id] || []).forEach((id, i) => {
      const g = id && guestById(id);
      if (g) rows.push([g.last, g.first, t.name, i + 1, DIET_LABEL[g.diet] || g.diet || "", g.allergy || ""]);
    });
  }
  for (const g of unseated()) rows.push([g.last, g.first, "Unseated", "", DIET_LABEL[g.diet] || g.diet || "", g.allergy || ""]);
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
  download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${slug()}-guests.csv`);
}

// Pictures always export on the light palette — better on screen and on paper.
function buildSvgString() {
  const { vb, inner } = planSvgInner({ theme: "light", forExport: true });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${Math.round(vb.w)}" height="${Math.round(vb.h)}">${inner}</svg>`;
}

function exportSvg() {
  download(new Blob([buildSvgString()], { type: "image/svg+xml" }), `${slug()}.svg`);
}

function exportPng() {
  const svg = buildSvgString();
  const vb = contentBox();
  const scale = Math.min(2, 4000 / vb.w);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vb.w * scale);
    canvas.height = Math.round(vb.h * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => { download(b, `${slug()}.png`); URL.revokeObjectURL(url); }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert("Sorry — the picture could not be made."); };
  img.src = url;
}

const MENUS = [["export-btn", "export-menu"], ["add-btn", "add-menu"]];
const closeMenus = except => {
  for (const [btn, list] of MENUS) {
    if (list === except) continue;
    $(list).hidden = true;
    $(btn).setAttribute("aria-expanded", "false");
  }
};
for (const [btn, list] of MENUS) {
  $(btn).onclick = () => {
    const open = $(list).hidden;
    closeMenus();
    $(list).hidden = !open;
    $(btn).setAttribute("aria-expanded", String(open));
  };
}
// pointerdown, not click: the plan calls preventDefault on pointerdown, which
// would swallow the click and leave a menu hanging open over the tables.
document.addEventListener("pointerdown", e => { if (!e.target.closest(".menu")) closeMenus(); });
$("export-menu").addEventListener("click", e => {
  const b = e.target.closest("button[data-export]"); if (!b) return;
  $("export-menu").hidden = true;
  ({ json: exportJson, csv: exportCsv, png: exportPng, svg: exportSvg })[b.dataset.export]();
});

$("import").onclick = () => $("file-input").click();
$("file-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.guests) || !Array.isArray(parsed.tables)) {
      throw new Error("not a plan file");
    }
    state = normalise(parsed);
    selectedTable = null; selectedPerson = null;
    commit(false); resetHistory(); render(); fitView();
    setStatus("Opened");
  } catch {
    alert("That file does not look like a saved plan. Pick a .json file that this app saved.");
  }
  e.target.value = "";
});

$("restore").onclick = () => {
  // This throws away an imported plan too, so be blunt about it.
  if (!confirm(
    "This replaces the plan you are looking at with the example one, and cannot be undone.\n\n" +
    "If this is your real plan, close this and use Save & share → Backup file first.\n\nReplace it?"
  )) return;
  state = normalise(window.DEFAULT_PLAN || { name: "Table plan", guests: [], tables: [] });
  selectedTable = null; selectedPerson = null;
  commit(false); resetHistory(); render(); fitView();
};

// ── Side panel ──────────────────────────────────────────────
const SIDE_KEY = "table-plan.side";
function setSide(collapsed) {
  $("layout").classList.toggle("collapsed", collapsed);
  $("toggle-side").setAttribute("aria-pressed", String(collapsed));
  try { localStorage.setItem(SIDE_KEY, collapsed ? "1" : "0"); } catch {}
  // The stage just changed width; ResizeObserver refits the viewBox.
}
$("toggle-side").onclick = () => setSide(!$("layout").classList.contains("collapsed"));

// ── Boot ────────────────────────────────────────────────────
try {
  if (localStorage.getItem(THEME) === "light") {
    document.documentElement.dataset.theme = "light";
    $("theme").textContent = "Dark";
  }
} catch {}

try {
  if (localStorage.getItem(SIDE_KEY) === "1") setSide(true);
} catch {}

state = loadState();
snapshot = JSON.stringify(state);

measureStage();
try {
  const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
  if (saved && Number.isFinite(saved.cx) && Number.isFinite(saved.cy) && saved.scale > 0) {
    view = { cx: saved.cx, cy: saved.cy, scale: clamp(saved.scale, MIN_SCALE, MAX_SCALE) };
  }
} catch {}

render();
if (!view) fitView();
setStatus("Saved");
