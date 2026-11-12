import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://jfgkghilikuhjijfvnjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_3kHpVg2NKf3MROQgYuIYjg_WMcg4h8l";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TBL_FZ = "fahrzeuge";
const TBL_BE = "belege";

const $ = (id) => document.getElementById(id);
const state = { vehicles: [], activeVehicleId: null, entries: [], avgByVehicle: {}, view: "table" };

// ================= DARK MODE (standardmäßig dunkel) =================
const themeToggleEl = $("themeToggle");

function initTheme() {
  const saved = localStorage.getItem("tankbuch-theme");
  const theme = saved || "dark";
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleEl.textContent = theme === "dark" ? "☀️" : "🌙";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#000000" : "#F2F2F7";
}

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("tankbuch-theme", next);
});

initTheme();

// ================= AUTH =================
const loginScreenEl = $("loginScreen");
const appScreenEl   = $("appScreen");
const loginFormEl   = $("loginForm");
const loginErrorEl  = $("loginError");
const loginBtnEl    = $("loginBtn");
const logoutBtnEl   = $("logoutBtn");

async function initAuth() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) showApp(); else showLogin();
  supabase.auth.onAuthStateChange((_e, session) => {
    if (session) showApp(); else showLogin();
  });
}

function showLogin() {
  loginScreenEl.style.display = "flex";
  appScreenEl.style.display   = "none";
  loginErrorEl.textContent = "";
}

function showApp() {
  loginScreenEl.style.display = "none";
  appScreenEl.style.display   = "block";
  loadVehicles();
}

loginFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("loginEmail").value.trim();
  const pass  = $("loginPass").value;
  loginBtnEl.disabled = true;
  loginBtnEl.textContent = "…";
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  loginBtnEl.disabled = false;
  loginBtnEl.textContent = "Anmelden";
  if (error) loginErrorEl.textContent = "Login fehlgeschlagen: " + error.message;
});

logoutBtnEl.addEventListener("click", () => supabase.auth.signOut());

// ================= BOTTOM SHEET (Pop) für + Beleg =================
const sheetOverlay  = $("entrySheetOverlay");
const sheetEl       = $("entrySheet");
const openSheetBtn  = $("openEntrySheet");
const sheetCloseBtn = $("sheetClose");

function openSheet() {
  sheetOverlay.style.display = "flex";
  const fDatum = $("fDatum");
  if (!fDatum.value) fDatum.value = new Date().toISOString().slice(0, 10);
  const lastRadae = localStorage.getItem("tankbuch-radae");
  if (lastRadae) $("fRadae").value = lastRadae;
  setTimeout(() => $("fKm").focus(), 100);
}

function closeSheet() {
  sheetOverlay.style.display = "none";
}

openSheetBtn.addEventListener("click", () => {
  // Wenn Diagramm aktiv ist, zurück zur Tabelle
  if (state.view === "chart") {
    state.view = "table";
    renderContent();
  }
  openSheet();
});

sheetCloseBtn.addEventListener("click", closeSheet);
sheetOverlay.addEventListener("click", (e) => {
  if (e.target === sheetOverlay) closeSheet();
});

// ================= FAHRZEUGE (Auswahl) =================
const vehicleTabsEl = $("vehicleTabs");
const statusEl      = $("status");
const emptyEl       = $("emptyState");
const formEl        = $("entryForm");

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? "var(--red)" : "var(--green)";
  if (msg) setTimeout(() => { statusEl.textContent = ""; }, 4000);
}

function fmt(n, d = 1) { return n == null ? "–" : Number(n).toFixed(d); }
function fmtKm(n)       { return n == null ? "–" : Number(n).toLocaleString("de-DE"); }

function parseNum(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return NaN;
  return parseFloat(s);
}

function avgOf(entries) {
  const rows = computeWithConsumption(entries);
  const valid = rows.filter(r => r.cons != null);
  if (!valid.length) return null;
  return valid.reduce((s, r) => s + r.cons, 0) / valid.length;
}

async function loadVehicles() {
  const { data, error } = await supabase.from(TBL_FZ).select().order("name");
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  state.vehicles = data || [];

  await loadAvgForAllVehicles();
  renderVehicleTabs();

  if (state.vehicles.length > 0) {
    if (!state.activeVehicleId || !state.vehicles.find(v => v.id === state.activeVehicleId)) {
      state.activeVehicleId = state.vehicles[0].id;
    }
    await selectVehicle(state.activeVehicleId);
  } else {
    state.activeVehicleId = null;
    emptyEl.style.display = "block";
    emptyEl.textContent   = "Noch kein Fahrzeug vorhanden.";
  }
}

async function loadAvgForAllVehicles() {
  const { data, error } = await supabase
    .from(TBL_BE)
    .select("fahrzeug_id, datum, km, menge, preis");
  if (error) return;
  const byVehicle = {};
  for (const e of (data || [])) {
    (byVehicle[e.fahrzeug_id] = byVehicle[e.fahrzeug_id] || []).push(e);
  }
  state.avgByVehicle = {};
  for (const vid in byVehicle) {
    state.avgByVehicle[vid] = avgOf(byVehicle[vid]);
  }
}

function renderVehicleTabs() {
  vehicleTabsEl.innerHTML = "";
  for (const v of state.vehicles) {
    const tab = document.createElement("div");
    tab.className = "vehicle-tab" + (v.id === state.activeVehicleId ? " active" : "");

    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = v.name;

    const avg = document.createElement("span");
    avg.className = "tab-avg";
    const avgVal = state.avgByVehicle[v.id];
    avg.textContent = avgVal != null ? "Ø " + fmt(avgVal) + " l/100 km" : "Ø –";

    tab.appendChild(name);
    tab.appendChild(avg);
    tab.addEventListener("click", () => selectVehicle(v.id));
    vehicleTabsEl.appendChild(tab);
  }
}

async function selectVehicle(id) {
  state.activeVehicleId = id;
  renderVehicleTabs();
  const { data, error } = await supabase.from(TBL_BE).select().eq("fahrzeug_id", id);
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  state.entries = data || [];
  renderContent();

  state.avgByVehicle[id] = avgOf(state.entries);
  renderVehicleTabs();
}

// ================= BELEGE – Echte Tabelle, kompakt, 1 Zeile pro Beleg =================
function computeWithConsumption(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.datum !== b.datum) return a.datum < b.datum ? -1 : 1;
    if (a.km !== b.km)       return a.km - b.km;
    return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
  });
  let prevKm = null;
  return sorted.map(e => {
    let cons = null, cost100 = null, distance = null;
    if (prevKm !== null && e.km > prevKm) {
      distance = e.km - prevKm;
      if (e.menge > 0) cons   = (e.menge / distance) * 100;
      if (e.menge > 0 && e.preis > 0)
        cost100 = (e.menge * e.preis) / distance * 100;
    }
    prevKm = e.km;
    return { ...e, distance, cons, cost100 };
  });
}

function fmtDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

const COLS = ["Datum", "km", "l", "l/100", "€/100", "€/l", "Reifen", "Tankart", "Bemerkung", ""];

function renderEntries() {
  const listEl = $("entriesList");
  listEl.innerHTML = "";
  const rows = computeWithConsumption(state.entries);

  if (rows.length === 0) {
    emptyEl.style.display = "block";
    emptyEl.textContent   = "Noch keine Belege für dieses Fahrzeug.";
    return;
  }
  emptyEl.style.display = "none";

  const table = document.createElement("table");
  table.className = "entry-table";

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  COLS.forEach(txt => {
    const th = document.createElement("th");
    th.textContent = txt;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  rows.reverse().forEach(r => {
    const tr = document.createElement("tr");

    const cells = [
      fmtDate(r.datum),
      fmtKm(r.km),
      Number(r.menge).toFixed(1),
      fmt(r.cons),
      fmt(r.cost100, 2),
      Number(r.preis).toFixed(2),
      r.radae || "–",
      r.voll ? "Voll" : "Teil",
      r.bemerkung || "",
    ];

    cells.forEach(text => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });

    const tdDel = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "entry-del";
    delBtn.title = "Beleg löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => deleteEntry(r.id));
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  listEl.appendChild(table);
}

function addEntry(e) {
  e.preventDefault();
  if (!state.activeVehicleId) return;

  const kmRaw    = parseInt($("fKm").value, 10);
  const mengeRaw = parseNum($("fMenge").value);
  const preisRaw = parseNum($("fPreis").value);

  if (!kmRaw || isNaN(mengeRaw) || isNaN(preisRaw) || mengeRaw <= 0 || preisRaw <= 0) {
    setStatus("Bitte km, Menge und Preis korrekt ausfüllen (Kommazahl erlaubt).", true);
    return;
  }

  const payload = {
    fahrzeug_id: state.activeVehicleId,
    datum:       $("fDatum").value || new Date().toISOString().slice(0, 10),
    km:          kmRaw,
    menge:       mengeRaw,
    preis:       preisRaw,
    radae:       $("fRadae").value,
    voll:        $("fVoll").value === "true",
    bemerkung:   $("fBemerkung").value.trim() || null,
  };

  try { localStorage.setItem("tankbuch-radae", payload.radae); } catch (_) {}

  supabase.from(TBL_BE).insert(payload).then(({ error }) => {
    if (error) { setStatus("Fehler: " + error.message, true); return; }
    formEl.reset();
    closeSheet();
    setStatus("Beleg gespeichert.");
    selectVehicle(state.activeVehicleId);
  });
}

function deleteEntry(id) {
  if (!confirm("Diesen Beleg löschen?")) return;
  supabase.from(TBL_BE).delete().eq("id", id).then(({ error }) => {
    if (error) { setStatus("Fehler: " + error.message, true); return; }
    setStatus("Beleg gelöscht.");
    selectVehicle(state.activeVehicleId);
  });
}

// ================= VIEW-WECHSEL: Tabelle ⇄ Diagramm =================
const entriesListEl = $("entriesList");
const chartWrapEl   = $("chartWrap");
const openChartBtn  = $("openChartBtn");
const openEntryBtn  = $("openEntrySheet");

function renderContent() {
  updateBtnStates();
  if (state.view === "chart") {
    entriesListEl.style.display = "none";
    chartWrapEl.style.display   = "block";
    emptyEl.style.display       = "none";
    renderChart();
  } else {
    chartWrapEl.style.display   = "none";
    entriesListEl.style.display = "block";
    renderEntries();
  }
}

function updateBtnStates() {
  if (openChartBtn) openChartBtn.classList.toggle("active", state.view === "chart");
  if (openEntryBtn) openEntryBtn.classList.toggle("active", state.view === "table");
}

function toggleView() {
  state.view = state.view === "table" ? "chart" : "table";
  if (state.view === "chart" && state.entries.length === 0) {
    state.view = "table";
    setStatus("Keine Belege vorhanden – Tabelle angezeigt.");
  }
  renderContent();
}

openChartBtn.addEventListener("click", toggleView);

// ================= DIAGRAMM: letzte 15 Werte (l/100 km) über Datum =================
function renderChart() {
  chartWrapEl.innerHTML = "";

  const all = computeWithConsumption(state.entries).filter(r => r.cons != null);
  if (all.length < 2) {
    const p = document.createElement("p");
    p.style.cssText = "text-align:center;color:var(--muted);padding:32px 16px;";
    p.textContent = all.length
      ? "Zu wenige berechenbare Werte (min. 2 nötig)."
      : "Noch keine berechenbaren Verbrauchsdaten.";
    chartWrapEl.appendChild(p);
    return;
  }

  // Letzte 15 Werte (chronologisch, neueste rechts)
  const data = all.slice(-15);

  const ns = "http://www.w3.org/2000/svg";
  const W = 640, H = 320;
  const padL = 48, padR = 20, padT = 44, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minC = Math.min(...data.map(d => d.cons));
  const maxC = Math.max(...data.map(d => d.cons));
  const cRange = (maxC - minC) || 1;
  const yMin = minC - cRange * 0.15;
  const yMax = maxC + cRange * 0.15;
  const yRange = (yMax - yMin) || 1;

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Titel
  const title = document.createElementNS(ns, "text");
  title.setAttribute("x", padL);
  title.setAttribute("y", 22);
  title.setAttribute("class", "chart-title");
  title.textContent = "Verbrauch · letzte " + data.length + " Werte";
  svg.appendChild(title);

  const sub = document.createElementNS(ns, "text");
  sub.setAttribute("x", W - padR);
  sub.setAttribute("y", 22);
  sub.setAttribute("text-anchor", "end");
  sub.setAttribute("class", "chart-sub");
  sub.textContent = "l/100 km über Datum";
  svg.appendChild(sub);

  // Y-Achse: 5 Grid-Linien + Labels
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const y = padT + plotH - (i / ySteps) * plotH;
    const val = yMin + (i / ySteps) * yRange;

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", padL); line.setAttribute("x2", W - padR);
    line.setAttribute("y1", y);    line.setAttribute("y2", y);
    line.setAttribute("class", "grid-line");
    svg.appendChild(line);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", padL - 6);
    label.setAttribute("y", y + 3);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "axis-label");
    label.textContent = val.toFixed(1);
    svg.appendChild(label);
  }

  // X-Achse: Datum-Labels (max. 5, gleichmäßig verteilt)
  const n = data.length;
  const xLabelCount = Math.min(n, 5);
  const labelIdxs = [];
  if (n <= 5) {
    for (let i = 0; i < n; i++) labelIdxs.push(i);
  } else {
    for (let i = 0; i < xLabelCount; i++) {
      labelIdxs.push(Math.round(i * (n - 1) / (xLabelCount - 1)));
    }
  }

  labelIdxs.forEach(i => {
    const x = padL + (i / (n - 1 || 1)) * plotW;
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", H - 12);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "axis-label");
    label.textContent = fmtDate(data[i].datum);
    svg.appendChild(label);
  });

  // Datenpunkte
  const pts = data.map((d, i) => {
    const x = padL + (i / (n - 1 || 1)) * plotW;
    const y = padT + plotH - ((d.cons - yMin) / yRange) * plotH;
    return { x, y, cons: d.cons };
  });

  // Linie (Polyline)
  const poly = document.createElementNS(ns, "polyline");
  poly.setAttribute("points", pts.map(p => `${p.x},${p.y}`).join(" "));
  poly.setAttribute("class", "data-line");
  svg.appendChild(poly);

  // Punkte + Werte über jedem Punkt
  pts.forEach(p => {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
    dot.setAttribute("r", "3.5");
    dot.setAttribute("class", "data-dot");
    svg.appendChild(dot);

    const val = document.createElementNS(ns, "text");
    val.setAttribute("x", p.x);
    val.setAttribute("y", p.y - 8);
    val.setAttribute("text-anchor", "middle");
    val.setAttribute("class", "data-value");
    val.textContent = p.cons.toFixed(1);
    svg.appendChild(val);
  });

  chartWrapEl.appendChild(svg);
}

// ================= INIT =================
formEl.addEventListener("submit", addEntry);
initAuth();
