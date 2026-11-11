import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = "https://jfgkghilikuhjijfvnjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_3kHpVg2NKf3MROQgYuIYjg_WMcg4h8l";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TBL_FZ = "fahrzeuge";
const TBL_BE = "belege";

const $ = (id) => document.getElementById(id);
const state = { vehicles: [], activeVehicleId: null, entries: [] };

// ================= AUTH =================
const loginScreenEl = $("loginScreen");
const appScreenEl   = $("appScreen");
const loginFormEl   = $("loginForm");
const loginErrorEl  = $("loginError");
const loginBtnEl    = $("loginBtn");
const logoutBtnEl   = $("logoutBtn");

async function initAuth() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) { showApp(); } else { showLogin(); }
  supabase.auth.onAuthStateChange((_e, session) => {
    if (session) showApp(); else showLogin();
  });
}

function showLogin() {
  loginScreenEl.style.display = "flex";
  appScreenEl.style.display = "none";
  loginErrorEl.textContent = "";
}

function showApp() {
  loginScreenEl.style.display = "none";
  appScreenEl.style.display = "block";
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

// ================= FAHRZEUGE =================
const vehicleTabsEl = $("vehicleTabs");
const tableBodyEl   = $("entriesBody");
const emptyEl       = $("emptyState");
const statusEl      = $("status");
const avgEl         = $("avgConsumption");
const formEl        = $("entryForm");

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? "#d0342c" : "#3a8a3a";
  if (msg) setTimeout(() => { statusEl.textContent = ""; }, 4000);
}
function fmt(n, d = 1) { return n == null ? "–" : Number(n).toFixed(d); }

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
    tableBodyEl.innerHTML = "";
    avgEl.textContent = "";
    emptyEl.style.display = "block";
    emptyEl.textContent = "Keine Fahrzeuge in der Datenbank.";
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
      const kn = document.createElement("span");
      kn.className = "tab-kenner";
      kn.textContent = v.kenner;
      name.appendChild(document.createTextNode(" "));
      name.appendChild(kn);
    }
    name.addEventListener("click", () => selectVehicle(v.id));

    const renameBtn = document.createElement("button");
    renameBtn.className = "icon-btn";
    renameBtn.title = "Umbenennen / bearbeiten";
    renameBtn.textContent = "✎";
    renameBtn.addEventListener("click", () => editVehicle(v));

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn del";
    delBtn.title = "Fahrzeug löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => deleteVehicle(v));

    tab.append(name, renameBtn, delBtn);
    vehicleTabsEl.appendChild(tab);
  }
}

async function editVehicle(v) {
  const name   = prompt("Name:", v.name);       if (!name) return;
  const kenner = prompt("Kennzeichen:", v.kenner || "");
  const fuel   = prompt("Kraftstoff (Benzin/Diesel/Autogas/Elektro/Hybrid):", v.fuel || "Benzin");
  const km     = parseInt(prompt("km-Stand:", v.km), 10);

  const { error } = await supabase.from(TBL_FZ)
    .update({ name: name.trim(), kenner: kenner.trim(), fuel: fuel.trim(), km: isNaN(km) ? v.km : km })
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

// ================= BELEGE =================
function computeWithConsumption(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.datum !== b.datum) return a.datum < b.datum ? -1 : 1;
    if (a.km !== b.km) return a.km - b.km;
    return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
  });
  let prevKm = null;
  return sorted.map(e => {
    let cons = null, cost100 = null, distance = null;
    if (prevKm !== null && e.km > prevKm) {
      distance = e.km - prevKm;
      if (e.menge > 0) cons = (e.menge / distance) * 100;
      if (e.menge > 0 && e.preis > 0) cost100 = (e.menge * e.preis) / distance * 100;
    }
    prevKm = e.km;
    return { ...e, distance, cons, cost100 };
  });
}

function renderEntries() {
  const rows = computeWithConsumption(state.entries);
  tableBodyEl.innerHTML = "";
  if (rows.length === 0) {
    emptyEl.style.display = "block";
    emptyEl.textContent = "Noch keine Belege für dieses Fahrzeug.";
    avgEl.textContent = "";
    return;
  }
  emptyEl.style.display = "none";
  rows.reverse().forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + r.datum + "</td>" +
      "<td>" + Number(r.km).toLocaleString("de-DE") + "</td>" +
      "<td>" + Number(r.menge).toFixed(1) + "</td>" +
      "<td>" + Number(r.preis).toFixed(3) + "</td>" +
      "<td>" + (r.radae || "–") + "</td>" +
      "<td>" + (r.voll ? "Voll" : "Teil") + "</td>" +
      "<td>" + fmt(r.cons) + "</td>" +
      "<td>" + fmt(r.cost100, 2) + " €</td>";
    const tda = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn row-del";
    delBtn.title = "Beleg löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => deleteEntry(r.id));
    tda.appendChild(delBtn);
    tr.appendChild(tda);
    tableBodyEl.appendChild(tr);
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
    setStatus("Bitte km, Menge und Preis korrekt ausfüllen.", true); return;
  }
  supabase.from(TBL_BE).insert(payload).then(({ error }) => {
    if (error) { setStatus("Fehler: " + error.message, true); return; }
    formEl.reset();
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
