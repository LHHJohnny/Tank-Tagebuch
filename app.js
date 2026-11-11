import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://jfgkghilikuhjijfvnjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_3kHpVg2NKf3MROQgYuIYjg_WMcg4h8l";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TBL_FZ = "fahrzeuge";
const TBL_BE = "belege";

const $ = (id) => document.getElementById(id);
const state = { vehicles: [], activeVehicleId: null, entries: [] };

// ================= DARK MODE =================
const themeToggleEl = $("themeToggle");

function initTheme() {
  const saved = localStorage.getItem("tankbuch-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
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

// ================= BOTTOM SHEET (Pop) =================
const sheetOverlay  = $("entrySheetOverlay");
const sheetEl       = $("entrySheet");
const openSheetBtn  = $("openEntrySheet");
const sheetCloseBtn = $("sheetClose");

function openSheet() {
  sheetOverlay.style.display = "flex";
  // Datum vorbelegen
  const fDatum = $("fDatum");
  if (!fDatum.value) fDatum.value = new Date().toISOString().slice(0, 10);
  // Fokus auf erstes Feld
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

// ================= FAHRZEUGE =================
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
    emptyEl.textContent   = "Noch kein Fahrzeug angelegt.";
    avgEl.textContent = "";
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
    if (v.kenner) {
      name.appendChild(document.createTextNode(" "));
      const kn = document.createElement("span");
      kn.className = "tab-kenner";
      kn.textContent = v.kenner;
      name.appendChild(kn);
    }
    name.addEventListener("click", () => selectVehicle(v.id));

    const renameBtn = document.createElement("button");
    renameBtn.className = "icon-btn";
    renameBtn.title = "Umbenennen / bearbeiten";
    renameBtn.textContent = "✎";
    renameBtn.addEventListener("click", (e) => { e.stopPropagation(); editVehicle(v); });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn del";
    delBtn.title = "Fahrzeug löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteVehicle(v); });

    tab.append(name, renameBtn, delBtn);
    vehicleTabsEl.appendChild(tab);
  }
}

async function addVehicle() {
  const name   = $("vName").value.trim();
  const kenner = $("vKenner").value.trim();
  const fuel   = $("vFuel").value;
  const km     = parseInt($("vKm").value, 10) || 0;
  if (!name) { setStatus("Bitte Fahrzeugname eingeben.", true); return; }

  const { data, error } = await supabase
    .from(TBL_FZ)
    .insert({ name, kenner, fuel, km })
    .select().single();
  if (error) { setStatus("Fehler: " + error.message, true); return; }

  $("vName").value = ""; $("vKenner").value = ""; $("vKm").value = "";
  setStatus("Fahrzeug angelegt.");
  await loadVehicles();
  selectVehicle(data.id);
}

async function editVehicle(v) {
  const name   = prompt("Name:", v.name);                 if (!name) return;
  const kenner = prompt("Kennzeichen:", v.kenner || "");
  const fuel   = prompt("Kraftstoff:", v.fuel || "Benzin");
  const km     = parseInt(prompt("km-Stand:", v.km), 10);

  const { error } = await supabase.from(TBL_FZ)
    .update({ name: name.trim(), kenner: kenner.trim(), fuel: fuel.trim(),
              km: isNaN(km) ? v.km : km })
    .eq("id", v.id);
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  setStatus("Gespeichert.");
  await loadVehicles();
}

async function deleteVehicle(v) {
  if (!confirm("„" + v.name + "“ und alle Belege löschen?")) return;
  const { error } = await supabase.from(TBL_FZ).delete().eq("id", v.id);
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  setStatus("Fahrzeug gelöscht.");
  await loadVehicles();
}

async function selectVehicle(id) {
  state.activeVehicleId = id;
  renderVehicleTabs();
  const { data, error } = await supabase.from(TBL_BE).select().eq("fahrzeug_id", id);
  if (error) { setStatus("Fehler: " + error.message, true); return; }
  state.entries = data || [];
  renderEntries();
}

// ================= BELEGE – CARD LAYOUT =================
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

  rows.reverse().forEach(r => {
    const card = document.createElement("div");
    card.className = "entry-card";

    // Header
    const header = document.createElement("div");
    header.className = "entry-header";
    const dateSpan = document.createElement("span");
    dateSpan.className = "entry-date";
    dateSpan.textContent = fmtDate(r.datum);
    const kmSpan = document.createElement("span");
    kmSpan.className = "entry-km";
    kmSpan.textContent = fmtKm(r.km) + " km";
    const delBtn = document.createElement("button");
    delBtn.className = "entry-del";
    delBtn.title = "Beleg löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => deleteEntry(r.id));
    header.append(dateSpan, kmSpan, delBtn);
    card.appendChild(header);

    // Stats grid
    const grid = document.createElement("div");
    grid.className = "entry-grid";

    const stats = [
      { label: "Menge",    value: Number(r.menge).toFixed(1) + " l" },
      { label: "Preis",    value: Number(r.preis).toFixed(3) + " €/l" },
      { label: "Reifen",   value: r.radae || "–" },
      { label: "Tankart",  value: r.voll ? "Voll" : "Teil" },
      { label: "Verbrauch",value: fmt(r.cons) + " l/100km", hl: r.cons != null },
      { label: "Kosten",   value: fmt(r.cost100, 2) + " €/100km", hl: r.cost100 != null },
    ];

    stats.forEach(s => {
      const stat = document.createElement("div");
      stat.className = "entry-stat";
      const lbl = document.createElement("span");
      lbl.className = "entry-stat-label";
      lbl.textContent = s.label;
      const val = document.createElement("span");
      val.className = "entry-stat-value" + (s.hl ? " highlight" : "");
      val.textContent = s.value;
      stat.append(lbl, val);
      grid.appendChild(stat);
    });

    card.appendChild(grid);

    // Bemerkung
    if (r.bemerkung) {
      const rem = document.createElement("div");
      rem.className = "entry-remark";
      rem.textContent = r.bemerkung;
      card.appendChild(rem);
    }

    listEl.appendChild(card);
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
    closeSheet();          // ← Pop schließen
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
$("addVehicleBtn").addEventListener("click", addVehicle);
$("vName").addEventListener("keydown", (e) => { if (e.key === "Enter") addVehicle(); });
initAuth();
