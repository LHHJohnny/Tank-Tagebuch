import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://jfgkghilikuhjijfvnjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_3kHpVg2NKf3MROQgYuIYjg_WMcg4h8l";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TBL_FZ      = "fahrzeuge";
const TBL_BE      = "belege";
const TBL_SERVICE = "service_eintraege";
const TBL_BEMERK  = "service_bemerkungen";

const $ = (id) => document.getElementById(id);
const state = {
  vehicles: [],
  activeVehicleId: null,
  entries: [],
  avgByVehicle: {},
  serviceEntries: [],
  serviceBemerkung: "",
  view: "tank"
};

// ================= DARK MODE (standardmÃ¤ÃŸig dunkel) =================
const themeToggleEl = $("themeToggle");

function initTheme() {
  const saved = localStorage.getItem("tankbuch-theme");
  const theme = saved || "dark";
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleEl.textContent = theme === "dark" ? "â˜€ï¸" : "ðŸŒ™";
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

// ================= VIEW SWITCHING (Dropdown am Titel) =================
const viewDropdownBtn  = $("viewDropdownBtn");
const viewDropdownList = $("viewDropdownList");
const appTitle         = $("appTitle");
const tankSection      = $("tankSection");
const serviceSection   = $("serviceSection");

function setView(view) {
  state.view = view;
  localStorage.setItem("tankbuch-view", view);

  appTitle.textContent = view === "tank" ? "â›½ Tankbuch" : "ðŸ”§ ServiceBuch";

  tankSection.style.display    = view === "tank" ? "block" : "none";
  serviceSection.style.display = view === "service" ? "block" : "none";

  viewDropdownList.querySelectorAll(".view-dropdown-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  renderVehicleTabs();

  if (state.activeVehicleId) {
    selectVehicle(state.activeVehicleId);
  }
}

viewDropdownBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = viewDropdownList.style.display === "flex";
  viewDropdownList.style.display = isOpen ? "none" : "flex";
});

viewDropdownList.querySelectorAll(".view-dropdown-item").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setView(btn.dataset.view);
    viewDropdownList.style.display = "none";
  });
});

document.addEventListener("click", () => {
  viewDropdownList.style.display = "none";
});

// Gespeicherte Ansicht wiederherstellen
const savedView = localStorage.getItem("tankbuch-view");
if (savedView === "service") setView("service");

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
  loginBtnEl.textContent = "â€¦";
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  loginBtnEl.disabled = false;
  loginBtnEl.textContent = "Anmelden";
  if (error) loginErrorEl.textContent = "Login fehlgeschlagen: " + error.message;
});

logoutBtnEl.addEventListener("click", () => supabase.auth.signOut());

// ================= BOTTOM SHEET (Pop) fÃ¼r + Tankbeleg =================
const sheetOverlay  = $("entrySheetOverlay");
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

openSheetBtn.addEventListener("click", openSheet);
sheetCloseBtn.addEventListener("click", closeSheet);
sheetOverlay.addEventListener("click", (e) => {
  if (e.target === sheetOverlay) closeSheet();
});

// ================= BOTTOM SHEET (Pop) fÃ¼r + Serviceeintrag =================
const serviceSheetOverlay  = $("serviceSheetOverlay");
const openServiceSheetBtn  = $("openServiceSheet");
const serviceSheetCloseBtn = $("serviceSheetClose");

function openServiceSheet() {
  serviceSheetOverlay.style.display = "flex";
  const sDatum = $("sDatum");
  if (!sDatum.value) sDatum.value = new Date().toISOString().slice(0, 10);
  setTimeout(() => $("sKm").focus(), 100);
}

function closeServiceSheet() {
  serviceSheetOverlay.style.display = "none";
}

openServiceSheetBtn.addEventListener("click", openServiceSheet);
serviceSheetCloseBtn.addEventListener("click", closeServiceSheet);
serviceSheetOverlay.addEventListener("click", (e) => {
  if (e.target === serviceSheetOverlay) closeServiceSheet();
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

function setServiceStatus(msg, isErr = false) {
  const el = $("serviceStatus");
  el.textContent = msg;
  el.style.color = isErr ? "var(--red)" : "var(--green)";
  if (msg) setTimeout(() => { el.textContent = ""; }, 4000);
}

function fmt(n, d = 1) { return n == null ? "â€“" : Number(n).toFixed(d); }
function fmtKm(n)       { return n == null ? "â€“" : Number(n).toLocaleString("de-DE"); }

// Robuste Zahl: erlaubt Komma oder Punkt, optional Leerstellen
function parseNum(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return NaN;
  return parseFloat(s);
}

// Durchschnittsverbrauch (l/100 km) Ã¼ber alle Belege eines Fahrzeugs
function avgOf(entries) {
  const rows = computeWithConsumption(entries);
  const valid = rows.filter(r => r.cons != null);
  if (!valid.length) return null;
  return valid.reduce((s, r) => s + r.cons, 0) / valid.length;
}

// Fahrzeug-Filter: Tankbuch nur Wagen, ServiceBuch alle (inkl. AnhÃ¤nger)
function getVisibleVehicles() {
  if (state.view === "tank") {
    return state.vehicles.filter(v => !v.typ || v.typ === "wagen");
  }
  return state.vehicles;
}

async function loadVehicles() {
  const { data, error } = await supabase.from(TBL_FZ).select().order("name");
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  state.vehicles = data || [];

  await loadAvgForAllVehicles();

  renderVehicleTabs();
  const visible = getVisibleVehicles();
  if (visible.length > 0) {
    if (!state.activeVehicleId || !visible.find(v => v.id === state.activeVehicleId)) {
      state.activeVehicleId = visible[0].id;
    }
    await selectVehicle(state.activeVehicleId);
  } else {
    state.activeVehicleId = null;
    if (state.view === "tank") {
      emptyEl.style.display = "block";
      emptyEl.textContent = "Kein Fahrzeug ausgewÃ¤hlt.";
    } else {
      const se = $("serviceEmpty");
      se.style.display = "block";
      se.textContent = "Kein Fahrzeug ausgewÃ¤hlt.";
    }
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
  const visible = getVisibleVehicles();
  for (const v of visible) {
    const tab = document.createElement("div");
    tab.className = "vehicle-tab" + (v.id === state.activeVehicleId ? " active" : "");

    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = v.name;

    const sub = document.createElement("span");
    sub.className = "tab-avg";
    if (state.view === "tank") {
      const avgVal = state.avgByVehicle[v.id];
      sub.textContent = avgVal != null ? "Ã˜ " + fmt(avgVal) + " l/100 km" : "Ã˜ â€“";
    } else {
      sub.textContent = (v.typ === "anhaenger" ? "ðŸš AnhÃ¤nger" : "ðŸš—");
    }

    tab.appendChild(name);
    tab.appendChild(sub);
    tab.addEventListener("click", () => selectVehicle(v.id));
    vehicleTabsEl.appendChild(tab);
  }
}

async function selectVehicle(id) {
  state.activeVehicleId = id;
  renderVehicleTabs();

  if (state.view === "tank") {
    const { data, error } = await supabase.from(TBL_BE).select().eq("fahrzeug_id", id);
    if (error) { setStatus("Fehler: " + error.message, true); return; }
    state.entries = data || [];
    renderEntries();
    state.avgByVehicle[id] = avgOf(state.entries);
    renderVehicleTabs();
  } else {
    await loadServiceData(id);
  }
}

// ================= BELEGE â€“ Echte Tabelle, kompakt, 1 Zeile pro Beleg =================
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
  if (!iso) return "â€“";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

const COLS = ["Datum", "km", "l", "l/100", "â‚¬/100", "â‚¬/l", "Reifen", "Tankart", "Bemerkung", ""];

function renderEntries() {
  const listEl = $("entriesList");
  listEl.innerHTML = "";
  const rows = computeWithConsumption(state.entries);

  if (rows.length === 0) {
    emptyEl.style.display = "block";
    emptyEl.textContent   = "Noch keine Belege fÃ¼r dieses Fahrzeug.";
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
      r.radae || "â€“",
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
    delBtn.title = "Beleg lÃ¶schen";
    delBtn.textContent = "âœ•";
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
    setStatus("Bitte km, Menge und Preis korrekt ausfÃ¼llen (Kommazahl erlaubt).", true);
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

  // Letzte Reifenwahl merken, fÃ¼rs nÃ¤chste Mal
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
  if (!confirm("Diesen Beleg lÃ¶schen?")) return;
  supabase.from(TBL_BE).delete().eq("id", id).then(({ error }) => {
    if (error) { setStatus("Fehler: " + error.message, true); return; }
    setStatus("Beleg gelÃ¶scht.");
    selectVehicle(state.activeVehicleId);
  });
}

// ================= SERVICEBUCH =================

async function loadServiceData(vehicleId) {
  // EintrÃ¤ge laden (neueste zuerst)
  const { data, error } = await supabase
    .from(TBL_SERVICE)
    .select()
    .eq("fahrzeug_id", vehicleId)
    .order("datum", { ascending: false });
  if (error) { setServiceStatus("Fehler: " + error.message, true); return; }
  state.serviceEntries = data || [];

  // Bemerkung laden
  const { data: bemData } = await supabase
    .from(TBL_BEMERK)
    .select("text")
    .eq("fahrzeug_id", vehicleId);
  state.serviceBemerkung = bemData?.[0]?.text || "";

  renderServiceOverview();
  renderServiceEntries();
}

function renderServiceOverview() {
  // Neuerster Eintrag pro Kategorie = "letzter".
  // "nÃ¤chster" = Zieldatum/Ziel-km desselben Eintrags. (R3/R4: nichts rechnen)
  const latestFor = (cat) => {
    return state.serviceEntries.find(e =>
      (e.kategorie || "").trim().toLowerCase() === cat.toLowerCase()
    ) || null;
  };

  const tuv = latestFor("TÃœV");
  const oil = latestFor("Ã–l");

  const fill = (lastEl, nextEl, e) => {
    if (!e) {
      lastEl.textContent = "â€“";
      nextEl.textContent = "â€“";
      return;
    }
    lastEl.textContent = fmtDate(e.datum) + " Â· " + fmtKm(e.km) + " km";
    if (e.zieldatum) {
      let txt = fmtDate(e.zieldatum);
      if (e.ziel_km != null) txt += " Â· " + fmtKm(e.ziel_km) + " km";
      nextEl.textContent = txt;
    } else {
      nextEl.textContent = "â€“";
    }
  };

  fill($("tuvLast"), $("tuvNext"), tuv);
  fill($("oilLast"), $("oilNext"), oil);

  // Bemerkungsfeld befÃ¼llen (ohne Event-Ring)
  const bemField = $("bemerkungField");
  bemField.onchange = null;
  bemField.value = state.serviceBemerkung;
  bemField.onchange = saveBemerkung;
}

async function saveBemerkung() {
  const text = $("bemerkungField").value.trim();
  if (!state.activeVehicleId) return;

  const { data } = await supabase
    .from(TBL_BEMERK)
    .select("id")
    .eq("fahrzeug_id", state.activeVehicleId);

  if (data && data.length) {
    await supabase.from(TBL_BEMERK)
      .update({ text, updated_at: new Date().toISOString() })
      .eq("fahrzeug_id", state.activeVehicleId);
  } else {
    await supabase.from(TBL_BEMERK)
      .insert({ fahrzeug_id: state.activeVehicleId, text });
  }
  setServiceStatus("Bemerkung gespeichert.");
}

const SVC_COLS = ["Datum", "Ziel", "km", "Ziel-km", "Kategorie", "Bemerkung", ""];

function renderServiceEntries() {
  const listEl = $("serviceList");
  listEl.innerHTML = "";
  const entries = state.serviceEntries;

  if (entries.length === 0) {
    $("serviceEmpty").style.display = "block";
    return;
  }
  $("serviceEmpty").style.display = "none";

  const table = document.createElement("table");
  table.className = "entry-table";

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  SVC_COLS.forEach(txt => {
    const th = document.createElement("th");
    th.textContent = txt;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  entries.forEach(r => {
    const tr = document.createElement("tr");

    const cells = [
      fmtDate(r.datum),
      r.zieldatum ? fmtDate(r.zieldatum) : "â€“",
      fmtKm(r.km),
      r.ziel_km != null ? fmtKm(r.ziel_km) : "â€“",
      r.kategorie || "â€“",
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
    delBtn.title = "Eintrag lÃ¶schen";
    delBtn.textContent = "âœ•";
    delBtn.addEventListener("click", () => deleteServiceEntry(r.id));
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  listEl.appendChild(table);
}

async function addServiceEntry(e) {
  e.preventDefault();
  if (!state.activeVehicleId) return;

  const kmRaw     = parseInt($("sKm").value, 10);
  const zielKmRaw = $("sZielKm").value ? parseInt($("sZielKm").value, 10) : null;
  const kat       = $("sKategorie").value.trim();

  if (!kmRaw || !kat) {
    setServiceStatus("Bitte km-Stand und Kategorie ausfÃ¼llen.", true);
    return;
  }

  const payload = {
    fahrzeug_id: state.activeVehicleId,
    datum:       $("sDatum").value || new Date().toISOString().slice(0, 10),
    zieldatum:   $("sZieldatum").value || null,
    km:          kmRaw,
    ziel_km:     zielKmRaw,
    kategorie:   kat,
    bemerkung:   $("sBemerkung").value.trim() || null,
  };

  const { error } = await supabase.from(TBL_SERVICE).insert(payload);
  if (error) { setServiceStatus("Fehler: " + error.message, true); return; }

  $("serviceForm").reset();
  closeServiceSheet();
  setServiceStatus("Eintrag gespeichert.");
  loadServiceData(state.activeVehicleId);
}

function deleteServiceEntry(id) {
  if (!confirm("Diesen Eintrag lÃ¶schen?")) return;
  supabase.from(TBL_SERVICE).delete().eq("id", id).then(({ error }) => {
    if (error) { setServiceStatus("Fehler: " + error.message, true); return; }
    setServiceStatus("Eintrag gelÃ¶scht.");
    loadServiceData(state.activeVehicleId);
  });
}

// ================= INIT =================
formEl.addEventListener("submit", addEntry);
$("serviceForm").addEventListener("submit", addServiceEntry);
initAuth();
