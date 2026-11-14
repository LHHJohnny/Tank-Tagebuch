import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://jfgkghilikuhjijfvnjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_3kHpVg2NKf3MROQgYuIYjg_WMcg4h8l";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TBL_FZ = "fahrzeuge";
const TBL_BE = "belege";
const TBL_SERV = "service_eintraege";
const TBL_REMARK = "service_bemerkungen";

const VIEW_NAMES = { tank: "⛽ Tankbuch", service: "🔧 Servicebuch" };
const BASE_CATEGORIES = ["Reifen", "Motor", "Öl", "TÜV", "Bremse"];
// Fahrzeugtypen, die im Tankbuch NICHT auswählbar sein dürfen (R6).
// Falls auch "Fahrrad" ausgeblendet werden soll, hier "fahrrad" ergänzen.
const NON_TANK_TYPES = ["anhaenger"];

const $ = (id) => document.getElementById(id);
const state = {
  view: "tank",          // "tank" | "service"
  vehicles: [],
  activeVehicleId: null,
  entries: [],           // Tankbelege aktives Fahrzeug
  serviceEntries: [],    // Servicedaten aktives Fahrzeug
  remark: "",            // Bemerkung (Sonstiges) aktives Fahrzeug
  avgByVehicle: {},
};

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

openSheetBtn.addEventListener("click", () => {
  if (state.view === "tank") openSheet(); else openServiceSheet();
});
sheetCloseBtn.addEventListener("click", closeSheet);
sheetOverlay.addEventListener("click", (e) => {
  if (e.target === sheetOverlay) closeSheet();
});

// ================= VIEW-UMSCHALTDROPDOWN (Tankbuch / Servicebuch) =================
const viewToggleBtn = $("viewToggleBtn");
const viewMenuEl    = $("viewMenu");
const viewTitleEl   = $("viewTitle");

viewToggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  viewMenuEl.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if (!viewMenuEl.contains(e.target)) viewMenuEl.classList.remove("open");
});

viewMenuEl.querySelectorAll(".dropdown-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    viewMenuEl.classList.remove("open");
    setView(btn.dataset.view);
  });
});

function markViewMenu() {
  viewMenuEl.querySelectorAll(".dropdown-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === state.view));
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  viewTitleEl.textContent = VIEW_NAMES[view];
  document.title = VIEW_NAMES[view];
  markViewMenu();

  const serviceMode = view === "service";
  $("serviceOverview").hidden = !serviceMode;
  $("entriesTitle").textContent = serviceMode ? "Servicedaten" : "Tankbelege";
  const fab = $("openEntrySheet");
  fab.title = serviceMode ? "Neuer Serviceeintrag" : "Neuer Beleg";
  fab.setAttribute("aria-label", fab.title);

  const allowed = visibleVehicles();
  if (!allowed.find((v) => v.id === state.activeVehicleId)) {
    state.activeVehicleId = allowed.length ? allowed[0].id : null;
  }
  if (state.activeVehicleId) selectVehicle(state.activeVehicleId);
  else renderEmpty("Noch kein Fahrzeug vorhanden.");
}

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

// Durchschnittsverbrauch (l/100 km) über alle gültigen Beleg-Segmente eines
// Fahrzeugs. Gewichteter Gesamtwert: Summe(Kraftstoff) / Summe(km) der
// gültigen Segmente, dadurch werden auch Teiltankungs-Segmente korrekt
// berücksichtigt (nicht nur der Mittel der Einzelwerte).
function avgOf(entries) {
  const rows = computeWithConsumption(entries);
  const valid = rows.filter(r => r.cons != null && r.distance > 0);
  if (!valid.length) return null;
  const totalDist = valid.reduce((s, r) => s + r.distance, 0);
  const totalFuel = valid.reduce((s, r) => s + (r.segFuel || 0), 0);
  if (totalDist > 0 && totalFuel > 0) {
    return (totalFuel / totalDist) * 100;
  }
  // Fallback (Kraftstoff nicht bestimmbar): einfacher Mittel der Segmente
  return valid.reduce((s, r) => s + r.cons, 0) / valid.length;
}

function normTyp(t) { return String(t || "wagen").toLowerCase().trim(); }

function visibleVehicles() {
  if (state.view === "tank") {
    return state.vehicles.filter((v) => !NON_TANK_TYPES.includes(normTyp(v.typ)));
  }
  return state.vehicles;
}

async function loadVehicles() {
  const { data, error } = await supabase.from(TBL_FZ).select().order("name");
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  state.vehicles = data || [];

  await loadAvgForAllVehicles();

  renderVehicleTabs();
  const allowed = visibleVehicles();
  if (allowed.length > 0) {
    if (!state.activeVehicleId || !allowed.find(v => v.id === state.activeVehicleId)) {
      state.activeVehicleId = allowed[0].id;
    }
    await selectVehicle(state.activeVehicleId);
  } else {
    state.activeVehicleId = null;
    renderEmpty("Noch kein Fahrzeug vorhanden.");
  }
}

async function loadAvgForAllVehicles() {
  const { data, error } = await supabase
    .from(TBL_BE)
    .select("fahrzeug_id, datum, km, menge, preis, voll");
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
  for (const v of visibleVehicles()) {
    const tab = document.createElement("div");
    tab.className = "vehicle-tab" + (v.id === state.activeVehicleId ? " active" : "");

    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = v.name;
    tab.appendChild(name);

    // Servicebuch: nur Name, kein Ø-Verbrauch (A1.1)
    if (state.view === "tank") {
      const avg = document.createElement("span");
      avg.className = "tab-avg";
      const avgVal = state.avgByVehicle[v.id];
      avg.textContent = avgVal != null ? "Ø " + fmt(avgVal) + " l/100 km" : "Ø –";
      tab.appendChild(avg);
    }
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
    await loadServiceData();
  }
}

// ================= BELEGE – Echte Tabelle, kompakt, 1 Zeile pro Beleg =================
//
// Verbrauch nach dem "Volltank-Verfahren":
// - Ein gültiger Verbrauch ist erst zwischen zwei VOLLEN Tankungen möglich.
// - Referenz = km-Stand der letzten VOLL-Tankung.
// - TEIL-Tankungen zwischendurch werden akkumuliert (Menge + Kosten), da ihr
//   Kraftstoff über das Segment ebenfalls verfahren wird. Sie zeigen selbst
//   keinen Verbrauch (–), weil dort kein geschlossener Referenzpunkt liegt.
// - Bei VOLL: Verbrauch = (akkumuliert + aktuelle Menge) / (km − Referenz-km) × 100,
//   danach Referenz auf aktuellen km setzen, Akkumulation leeren.
// - Bei VOLL ohne vorherige Referenz (erste Zeile / Lücke): kein Verbrauch,
//   Referenz setzen, zuvor Akkumuliertes verwerfen.
function computeWithConsumption(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.datum !== b.datum) return a.datum < b.datum ? -1 : 1;
    if (a.km !== b.km)       return a.km - b.km;
    return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
  });
  let refKm = null;   // km-Stand der letzten VOLL-Tankung
  let pendFuel = 0;   // akkumulierte Teilmengen seit letzter VOLL-Tankung
  let pendCost = 0;   // akkumulierte Teilkosten seit letzter VOLL-Tankung
  return sorted.map(e => {
    let cons = null, cost100 = null, distance = null, segFuel = null;
    if (e.voll) {
      if (refKm !== null && e.km > refKm) {
        distance = e.km - refKm;
        const fuel = pendFuel + e.menge;
        segFuel = fuel;
        if (fuel > 0) cons = (fuel / distance) * 100;
        if (fuel > 0) cost100 = (pendCost + e.menge * e.preis) / distance * 100;
      }
      refKm = e.km;
      pendFuel = 0;
      pendCost = 0;
    } else {
      // Teiltankung: nur akkumulieren, eigener Verbrauch nicht bestimmbar
      pendFuel += e.menge;
      pendCost += e.menge * (e.preis || 0);
    }
    return { ...e, distance, cons, cost100, segFuel };
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

// ================= SERVICEBUCH – Daten laden =================
async function loadServiceData() {
  const id = state.activeVehicleId;
  if (!id) { renderEmpty("Noch kein Fahrzeug vorhanden."); return; }

  const [resEntries, resRemark] = await Promise.all([
    supabase.from(TBL_SERV).select().eq("fahrzeug_id", id),
    supabase.from(TBL_REMARK).select().eq("fahrzeug_id", id).maybeSingle(),
  ]);
  if (resEntries.error) { setStatus("Fehler: " + resEntries.error.message, true); return; }

  state.serviceEntries = resEntries.data || [];
  state.remark = resRemark.data ? (resRemark.data.text || "") : "";

  const remarkEl = $("fRemark");
  if (document.activeElement !== remarkEl) remarkEl.value = state.remark;
  remarkDirty = false;
  setRemarkStatus("");

  renderOverview();
  renderServiceEntries();
}

function renderEmpty(msg) {
  emptyEl.style.display = "block";
  emptyEl.textContent = msg;
}

// ================= SERVICEBUCH – Grunddaten-Karten (Ü1, Ü2) =================
// Rein statisch: "Letzter" = neuer Eintrag der Kategorie,
// "Nächster" = Ziel-Datum/Ziel-km desselben Eintrags. Es wird nichts berechnet (R3).
function normKat(s) { return String(s || "").trim().toLowerCase(); }

function latestServiceEntry(kat) {
  const list = state.serviceEntries
    .filter((e) => normKat(e.kategorie) === normKat(kat))
    .sort((a, b) =>
      a.datum !== b.datum ? (a.datum < b.datum ? -1 : 1) : (a.km || 0) - (b.km || 0));
  return list.length ? list[list.length - 1] : null;
}

function overviewLast(entry) {
  if (!entry) return "–";
  const parts = [];
  if (entry.datum) parts.push(fmtDate(entry.datum));
  if (entry.km) parts.push(fmtKm(entry.km) + " km");
  return parts.length ? parts.join(" · ") : "–";
}

function overviewNext(entry) {
  if (!entry) return "–";
  const parts = [];
  if (entry.zieldatum) parts.push(fmtDate(entry.zieldatum));
  if (entry.ziel_km) parts.push(fmtKm(entry.ziel_km) + " km");
  return parts.length ? parts.join(" · ") : "–";
}

function renderOverview() {
  const tuv = latestServiceEntry("TÜV");
  const oil = latestServiceEntry("Öl");
  $("ovTuvLast").textContent = overviewLast(tuv);
  $("ovTuvNext").textContent = overviewNext(tuv);
  $("ovOilLast").textContent = overviewLast(oil);
  $("ovOilNext").textContent = overviewNext(oil);
}

// ================= SERVICEBUCH – Tabelle "Servicedaten" (B4, B5) =================
const SVC_COLS = ["Datum", "km", "Kategorie", "Ziel", "Bemerkung", ""];

function serviceTargetText(r) {
  const parts = [];
  if (r.zieldatum) parts.push(fmtDate(r.zieldatum));
  if (r.ziel_km) parts.push(fmtKm(r.ziel_km) + " km");
  return parts.length ? parts.join(" · ") : "–";
}

function renderServiceEntries() {
  const listEl = $("entriesList");
  listEl.innerHTML = "";
  const rows = [...state.serviceEntries].sort((a, b) => {
    if (a.datum !== b.datum) return a.datum < b.datum ? 1 : -1; // neueste oben
    if ((a.km || 0) !== (b.km || 0)) return (b.km || 0) - (a.km || 0);
    return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
  });

  if (rows.length === 0) {
    renderEmpty("Noch keine Servicedaten für dieses Fahrzeug.");
    return;
  }
  emptyEl.style.display = "none";

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

  rows.forEach(r => {
    const tr = document.createElement("tr");

    const cells = [
      fmtDate(r.datum),
      fmtKm(r.km),
      r.kategorie || "–",
      serviceTargetText(r),
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
    delBtn.title = "Eintrag löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => deleteServiceEntry(r.id));
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  listEl.appendChild(table);
}

function deleteServiceEntry(id) {
  if (!confirm("Diesen Serviceeintrag löschen?")) return;
  supabase.from(TBL_SERV).delete().eq("id", id).then(({ error }) => {
    if (error) { setStatus("Fehler: " + error.message, true); return; }
    setStatus("Eintrag gelöscht.");
    loadServiceData();
  });
}

// ================= SERVICEBUCH – Bemerkung "Sonstiges" (Ü3) =================
// Pro Fahrzeug genau 1 Zeile in service_bemerkungen (Upsert).
const remarkEl = $("fRemark");
let remarkDirty = false;

function setRemarkStatus(msg) {
  const el = $("remarkStatus");
  el.textContent = msg || "";
  el.style.color = msg && msg.indexOf("Fehler") === 0 ? "var(--red)" : "";
}

remarkEl.addEventListener("input", () => {
  if (remarkEl.value === (state.remark || "")) {
    remarkDirty = false;
    setRemarkStatus("");
    return;
  }
  remarkDirty = true;
  setRemarkStatus("Änderung erkannt – Feld verlassen zum Speichern");
});

remarkEl.addEventListener("blur", () => {
  if (remarkDirty) saveRemark();
});

async function saveRemark() {
  if (!state.activeVehicleId || !remarkDirty) return;
  const text = remarkEl.value.trim() || "";
  const { error } = await supabase.from(TBL_REMARK).upsert(
    { fahrzeug_id: state.activeVehicleId, text: text, updated_at: new Date().toISOString() },
    { onConflict: "fahrzeug_id" }
  );
  remarkDirty = false;
  if (error) { setRemarkStatus("Fehler: " + error.message); return; }
  state.remark = text;
  setRemarkStatus("Gespeichert ✓");
  setTimeout(() => { if (!remarkDirty) setRemarkStatus(""); }, 2500);
}

// ================= BOTTOM SHEET (Pop) für + Serviceeintrag =================
const serviceSheetOverlay = $("serviceSheetOverlay");
const serviceSheetCloseBtn = $("serviceSheetClose");
const sKategorieSel = $("sKategorie");
const sCustomKatWrap = $("sCustomKatWrap");

function buildCategoryOptions() {
  // Basis-Kategorien (B2) + bereits benutzte freie Schlagworte dieses Fahrzeugs
  const cats = [...BASE_CATEGORIES];
  for (const e of state.serviceEntries) {
    const k = (e.kategorie || "").trim();
    if (k && !cats.some((c) => normKat(c) === normKat(k))) cats.push(k);
  }
  sKategorieSel.innerHTML = "";
  cats.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sKategorieSel.appendChild(opt);
  });
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "Eigene Kategorie …";
  sKategorieSel.appendChild(custom);
}

function syncCustomKat() {
  sCustomKatWrap.style.display = sKategorieSel.value === "__custom__" ? "flex" : "none";
}

function openServiceSheet() {
  serviceSheetOverlay.style.display = "flex";
  const fDatum = $("sDatum");
  if (!fDatum.value) fDatum.value = new Date().toISOString().slice(0, 10);
  buildCategoryOptions();
  syncCustomKat();
  setTimeout(() => $("sKm").focus(), 100);
}

function closeServiceSheet() {
  serviceSheetOverlay.style.display = "none";
}

sKategorieSel.addEventListener("change", syncCustomKat);
serviceSheetCloseBtn.addEventListener("click", closeServiceSheet);
serviceSheetOverlay.addEventListener("click", (e) => {
  if (e.target === serviceSheetOverlay) closeServiceSheet();
});

function addServiceEntry(e) {
  e.preventDefault();
  if (!state.activeVehicleId) return;

  const km = parseInt($("sKm").value, 10);
  if (!km || km <= 0) {
    setStatus("Bitte einen km-Stand eingeben (größer 0).", true);
    return;
  }

  let kategorie = sKategorieSel.value;
  if (kategorie === "__custom__") {
    kategorie = $("sCustomKat").value.trim();
    if (!kategorie) {
      setStatus("Bitte die eigene Kategorie (Schlagwort) eingeben.", true);
      return;
    }
  }

  const zielKmRaw = parseInt($("sZielKm").value, 10);
  const payload = {
    fahrzeug_id: state.activeVehicleId,
    datum:       $("sDatum").value || new Date().toISOString().slice(0, 10),
    km:          km,
    kategorie:   kategorie,
    zieldatum:   $("sZieldatum").value || null,
    ziel_km:     zielKmRaw > 0 ? zielKmRaw : null,
    bemerkung:   $("sBemerkung").value.trim() || null,
  };

  supabase.from(TBL_SERV).insert(payload).then(({ error }) => {
    if (error) { setStatus("Fehler: " + error.message, true); return; }
    $("serviceForm").reset();
    closeServiceSheet();
    setStatus("Serviceeintrag gespeichert.");
    loadServiceData();
  });
}

// ================= INIT =================
formEl.addEventListener("submit", addEntry);
$("serviceForm").addEventListener("submit", addServiceEntry);
markViewMenu();
initAuth();
