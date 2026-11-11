import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://jfgkghilikuhjijfvnjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_3kHpVg2NKf3MROQgYuIYjg_WMcg4h8l";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TBL_FZ = "fahrzeuge";
const TBL_BE = "belege";

const $ = (id) => document.getElementById(id);
const state = { vehicles: [], activeVehicleId: null, entries: [] };

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

// ================= FAHRZEUGE (nur Auswahl) =================
const vehicleTabsEl = $("vehicleTabs");
const statusEl      = $("status");
const avgEl         = $("avgConsumption");
const emptyEl       = $("emptyState");
const formEl        = $("entryForm");

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? "var(--red)" : "var(--green)";
  if (msg) setTimeout(() => { statusEl.textContent = ""; }, 4000);
}

function fmt(n, d = 1) { return n == null ? "–" : Number(n).toFixed(d); }
function fmtKm(n)        { return n == null ? "–" : Number(n).toLocaleString("de-DE"); }

async function loadVehicles() {
  const { data, error } = await supabase.from(TBL_FZ).select().order("name");
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  state.vehicles = data || [];
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
    avgEl.textContent = "";
  }
}

// Nur die Auswahl zwischen den Autos – kein Anlegen, kein Bearbeiten, kein Löschen.
function renderVehicleTabs() {
  vehicleTabsEl.innerHTML = "";
  for (const v of state.vehicles) {
    const tab = document.createElement("div");
    tab.className = "vehicle-tab" + (v.id === state.activeVehicleId ? " active" : "");

    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = v.name;
    if (v.kenner) {
      name.appendChild(document.createTextNode(" "));
      const kn = document.createElement("span");
      kn.className = "tab-kenner";
      kn.textContent = v.kenner;
      name.appendChild(kn);
    }
    name.addEventListener("click", () => selectVehicle(v.id));

    tab.appendChild(name);
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
}

// ================= BELEGE – tabellarisch, 2 Zeilen pro Beleg =================
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

function mkSpan(cls, text) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

function renderEntries() {
  const listEl = $("entriesList");
  listEl.innerHTML = "";
  const rows = computeWithConsumption(state.entries);

  if (rows.length === 0) {
    emptyEl.style.display = "block";
    emptyEl.textContent   = "Noch keine Belege für dieses Fahrzeug.";
    avgEl.textContent = "";
    return;
  }
  emptyEl.style.display = "none";

  // Kopfzeile (Spaltenbeschriftung)
  const head = document.createElement("div");
  head.className = "entry-row entry-head";
  const headLine = document.createElement("div");
  headLine.className = "entry-line";
  [["e-date","Datum"], ["e-km","km"], ["e-val","l"], ["e-val","l/100"], ["e-val","€/100"]]
    .forEach(([cls, txt]) => headLine.appendChild(mkSpan(cls, txt)));
  head.appendChild(headLine);
  listEl.appendChild(head);

  // Belege – jeder kompakt in 2 Zeilen
  rows.reverse().forEach(r => {
    const row = document.createElement("div");
    row.className = "entry-row";

    // Zeile 1 – Hauptwerte
    const l1 = document.createElement("div");
    l1.className = "entry-line entry-line-1";
    l1.appendChild(mkSpan("e-date", fmtDate(r.datum)));
    l1.appendChild(mkSpan("e-km", fmtKm(r.km) + " km"));
    l1.appendChild(mkSpan("e-val", Number(r.menge).toFixed(1) + " l"));
    l1.appendChild(mkSpan("e-val hl", fmt(r.cons) + " l/100"));
    l1.appendChild(mkSpan("e-val hl", fmt(r.cost100, 2) + " €/100"));

    // Zeile 2 – Nebenwerte + Löschen
    const l2 = document.createElement("div");
    l2.className = "entry-line entry-line-2";
    l2.appendChild(mkSpan("e-sub", Number(r.preis).toFixed(2) + " €/l"));
    l2.appendChild(mkSpan("e-sub", r.radae || "–"));
    l2.appendChild(mkSpan("e-sub", r.voll ? "Voll" : "Teil"));
    if (r.bemerkung) l2.appendChild(mkSpan("e-remark", r.bemerkung));

    const delBtn = document.createElement("button");
    delBtn.className = "entry-del";
    delBtn.title = "Beleg löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => deleteEntry(r.id));
    l2.appendChild(delBtn);

    row.append(l1, l2);
    listEl.appendChild(row);
  });

  const valid = rows.filter(r => r.cons != null);
  avgEl.textContent = valid.length
    ? "Ø Verbrauch: " + fmt(valid.reduce((s, r) => s + r.cons, 0) / valid.length) + " l/100 km"
    : "Ø: –";
}

function addEntry(e) {
  e.preventDefault();
  if (!state.activeVehicleId) return;
  const payload = {
    fahrzeug_id: state.activeVehicleId,
    datum:       $("fDatum").value || new Date().toISOString().slice(0, 10),
    km:          parseInt($("fKm").value, 10),
    menge:       parseFloat($("fMenge").value.replace(",", ".")),
    preis:       parseFloat($("fPreis").value.replace(",", ".")),
    radae:       $("fRadae").value,
    voll:        $("fVoll").value === "true",
    bemerkung:   $("fBemerkung").value.trim() || null,
  };
  if (!payload.km || isNaN(payload.menge) || isNaN(payload.preis)) {
    setStatus("Bitte km, Menge und Preis korrekt ausfüllen.", true);
    return;
  }
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
