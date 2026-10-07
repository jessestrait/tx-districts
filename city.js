/* Texas Congressional Districts — 2026 voting guide.
 *
 * Two boundary sets: the map Texas used in 2022/2024 ("2021 map", Census
 * CD118) and the map the legislature redrew in August 2025 and SCOTUS let
 * stand for the midterms ("2026 map", Census CD120).
 *
 * CD120, not CD119 — and that distinction is the whole ballgame. The 119th
 * Congress was *elected* in Nov 2024, under the old lines, so the CD119 file
 * carries the 2021 map no matter that Census reissued it in Sept 2025. The
 * new lines first elect a Congress in Nov 2026: the 120th. Build this page
 * from CD119 and you get two copies of the same map and a toggle that
 * silently does nothing.
 *
 * District numbers in both GeoJSONs are the Census GEOID's last two digits,
 * 01-38 — reps.json keys match that, as plain "1".."38" (no leading zero).
 *
 * Hover updates the fixed right-hand panel rather than floating a tooltip at
 * the cursor: the reader's eye lands in one place, and the readout survives
 * the mouse leaving the map.
 */

const DATA = {
  "2025": { geojson: "data/tx_cd120_2026.geojson", repKey: "map_2025" },
  "2021": { geojson: "data/tx_cd118_2021map.geojson", repKey: "map_2021" },
};

const ELECTION_DAY = "2026-11-03";
const KEY_DATES = [
  { what: "Voter registration deadline", when: "2026-10-05", label: "Oct 5" },
  { what: "Early voting begins", when: "2026-10-19", label: "Oct 19" },
  { what: "Last day to apply for mail ballot", when: "2026-10-23", label: "Oct 23" },
  { what: "Early voting ends", when: "2026-10-30", label: "Oct 30" },
  { what: "Election Day", when: ELECTION_DAY, label: "Nov 3" },
];

const map = L.map("map", {
  zoomControl: true,
  minZoom: 5,
  maxZoom: 11,
}).setView([31.4, -99.3], 6);

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
  attribution: "Esri &mdash; district lines: US Census Bureau TIGER/Line",
}).addTo(map);
L.tileLayer(ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
  pane: "overlayPane",
}).addTo(map);

let reps = {};
let fitted = false;
let activeLayer = null;
let activeMapKey = "2025";
let pinnedNum = null;
const loadedGeo = {};
const CAN_HOVER = window.matchMedia("(hover: hover)").matches;

/* Leaflet caches the container size, and the GeoJSON fetch can resolve before
   the container has real dimensions — a zero-height container makes fitBounds
   clamp to maxZoom, which lands you on a blank patch of rural Texas. So re-fit
   on every resize until the reader takes the wheel themselves. */
let userMoved = false;
let fitting = false;
map.on("dragstart zoomstart", () => { if (!fitting) userMoved = true; });
map.on("resize", () => { if (!userMoved) fitTexas(); });

function fitTexas() {
  if (!activeLayer) return;
  fitting = true;
  map.invalidateSize(false);
  map.fitBounds(activeLayer.getBounds(), { padding: [20, 20], animate: false });
  fitting = false;
}

const $ = (id) => document.getElementById(id);
const getVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function partyColor(p) {
  return p === "R" ? getVar("--rep") : p === "D" ? getVar("--dem") : getVar("--vacant");
}
/* With no incumbent on the ballot the colour is a partisan lean, not a seat
   somebody holds — say so, rather than calling an open seat "Republican". */
function partyLabel(p, lean) {
  if (p === "R") return lean ? "Republican-leaning" : "Republican";
  if (p === "D") return lean ? "Democratic-leaning" : "Democrat";
  return "Vacant / unclear";
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function districtNum(feature) {
  // GEOID = state FIPS (48) + 2-digit district
  const geoid = feature.properties.GEOID || feature.properties.GEOIDFQ || "";
  return String(parseInt(geoid.replace(/\D/g, "").slice(-2), 10));
}

function infoFor(num, mapKey) {
  return (reps[DATA[mapKey].repKey] || {})[num] || null;
}

/* reps.json flags the districts whose sourcing was thin or conflicting. Those
   get said out loud in the panel rather than asserted as settled fact. */
function flagFor(num) {
  const flags = (reps.sourcing_flags || {}).weak_or_conflicting || [];
  return flags.find((f) => new RegExp("^" + num + "\\b|^" + num + "[/ (]").test(f.trim())) || null;
}

function styleFor(num, mapKey) {
  const info = infoFor(num, mapKey);
  return {
    color: "#0b1018",
    weight: 1,
    fillColor: partyColor(info && info.party),
    fillOpacity: 0.55,
  };
}

/* ── the panel readout ── */
function showDistrict(num, mapKey) {
  const info = infoFor(num, mapKey);
  $("d-empty").style.display = "none";
  $("d-body").classList.add("on");
  $("d-num").textContent = "District " + num;

  const party = info ? info.party : null;
  const name = info ? (mapKey === "2021" ? info.rep : info.incumbent_or_favored) : null;
  $("d-party").innerHTML =
    `<span class="dot" style="background:${partyColor(party)}"></span>${partyLabel(party, !name)}`;
  $("d-rep").textContent = name || (info ? "No incumbent running" : "Data unavailable");

  let status;
  if (mapKey === "2021") {
    status = info && info.first_elected
      ? `In office since ${info.first_elected} · elected under the 2021 map`
      : "Elected under the 2021 map (used 2022 & 2024)";
  } else {
    status = info && info.status ? info.status : "";
  }
  $("d-status").textContent = status;

  const notes = info && info.notes ? info.notes : "";
  $("d-notes").textContent = notes;
  $("d-notes").style.display = notes ? "" : "none";

  const flag = flagFor(num);
  $("d-flag").hidden = !flag;
  if (flag) $("d-flag").textContent = "Sourcing note: " + flag;

  $("d-open").href = `district.html?d=${encodeURIComponent(num)}&map=${encodeURIComponent(mapKey)}`;
}

function renderDates() {
  const today = new Date().toISOString().slice(0, 10);
  $("dates").innerHTML = KEY_DATES.map((d) => {
    const past = d.when < today;
    const soon = !past && daysBetween(today, d.when) <= 14;
    return `<div class="date-row${past ? " past" : soon ? " soon" : ""}">
      <span class="what">${esc(d.what)}</span><span class="when">${esc(d.label)}</span></div>`;
  }).join("");

  const days = daysBetween(today, ELECTION_DAY);
  $("countdown").innerHTML =
    days > 0 ? `<b>${days}</b> day${days === 1 ? "" : "s"} until Election Day`
    : days === 0 ? "<b>Today</b> is Election Day"
    : "The Nov 3, 2026 election has passed.";
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / 86400000);
}

function renderTally(gj, mapKey) {
  let r = 0, d = 0, other = 0;
  gj.features.forEach((f) => {
    const p = (infoFor(districtNum(f), mapKey) || {}).party;
    if (p === "R") r++; else if (p === "D") d++; else other++;
  });
  $("tally").innerHTML =
    `<div class="r"><b>${r}</b>Republican</div><div class="d"><b>${d}</b>Democrat</div>` +
    (other ? `<div><b>${other}</b>Other</div>` : "");
}

function loadGeo(mapKey) {
  if (loadedGeo[mapKey]) return Promise.resolve(loadedGeo[mapKey]);
  return fetch(DATA[mapKey].geojson).then((r) => r.json()).then((gj) => {
    loadedGeo[mapKey] = gj;
    return gj;
  });
}

function renderMap(mapKey) {
  activeMapKey = mapKey;
  pinnedNum = null;
  loadGeo(mapKey).then((gj) => {
    if (activeLayer) map.removeLayer(activeLayer);
    activeLayer = L.geoJSON(gj, {
      style: (f) => styleFor(districtNum(f), mapKey),
      onEachFeature: (f, layer) => {
        const num = districtNum(f);
        layer.on("mouseover", () => {
          layer.setStyle({ weight: 2.5, fillOpacity: 0.78 });
          layer.bringToFront();
          showDistrict(num, activeMapKey);
        });
        layer.on("mouseout", () => {
          layer.setStyle(styleFor(num, activeMapKey));
          if (pinnedNum) showDistrict(pinnedNum, activeMapKey);
        });
        /* With a mouse, hover has already filled the panel, so a click means
           "take me there". On touch there is no hover at all — a tap has to be
           able to just fill the panel, or the reader can never look at a
           district without being thrown onto another page. */
        layer.on("click", () => {
          pinnedNum = num;
          showDistrict(num, activeMapKey);
          if (CAN_HOVER) {
            window.location.href =
              `district.html?d=${encodeURIComponent(num)}&map=${encodeURIComponent(activeMapKey)}`;
          }
        });
      },
    }).addTo(map);
    if (!fitted) { fitTexas(); fitted = true; }
    renderTally(gj, mapKey);
  });
}

function setActiveButton(mapKey) {
  $("btn-2025").classList.toggle("active", mapKey === "2025");
  $("btn-2021").classList.toggle("active", mapKey === "2021");
  $("map-caveat").textContent = mapKey === "2025"
    ? "The 2026 map: redrawn Aug 2025, allowed to stand by the Supreme Court in Dec 2025. These are the lines you vote under on Nov 3."
    : "The 2021 map: used in the 2022 and 2024 elections, superseded for 2026. Shown for comparison.";
}

$("btn-2025").addEventListener("click", () => {
  if (activeMapKey === "2025") return;
  setActiveButton("2025"); renderMap("2025");
});
$("btn-2021").addEventListener("click", () => {
  if (activeMapKey === "2021") return;
  setActiveButton("2021"); renderMap("2021");
});

renderDates();

fetch("data/reps.json")
  .then((r) => (r.ok ? r.json() : {}))
  .then((json) => { reps = json; })
  .catch(() => { reps = {}; })
  .finally(() => { setActiveButton("2025"); renderMap("2025"); });
