import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://jfgkghilikuhjijfvnjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_3kHpVg2NKf3MROQgYuIYjg_WMcg4h8l";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TBL_FZ = "fahrzeuge";
const TBL_BE = "belege";

const $ = (id) => document.getElementById(id);
const state = { vehicles: [], activeVehicleId: null, entries: [], avgByVehicle: {} };

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
  // Letzte Reifenwahl wiederherstellen (predefined)
  const lastRadae = localStorage.getItem("tankbuch-radae");
  if (lastRadae) $("fRadae").value = lastRadae;
  setTimeout(() => $("fKm").focus(), 100);
}

function closeSheet() {
  sheetOverlay.style.display = "none";
}

openSheetBtn.addEventListener("click", openSheet);
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
function fmtKm(n)        { return n == null ? "–" : Number(n).toLocaleString("de-DE"); }

// Robuste Zahl: erlaubt Komma oder Punkt, optional Leerstellen
function parseNum(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return NaN;
  const n = parseFloat(s);
  return n;
}

// Durchschnittsverbrauch (l/100 km) über alle Belege eines Fahrzeugs
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
  renderEntries();

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

  // Letzte Reifenwahl merken, fürs nächste Mal
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

// ================= INIT =================
formEl.addEventListener("submit", addEntry);
initAuth();
