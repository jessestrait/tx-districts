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
  const c = partyColor(info && info.party);
  return {
    color: c,          // lines in the district's own colour, not near-black:
    weight: 1.1,       // at statewide zoom that is what reads as circuitry
    opacity: 0.85,
    fillColor: c,
    fillOpacity: 0.42,
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
          layer.setStyle({ weight: 2.6, opacity: 1, fillOpacity: 0.72, color: "#ffffff" });
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

/* ── "which district am I in?" ──
 *
 * The honest caveat, learned the hard way: district lines follow streets, and a
 * house can sit tens of metres from one. Browser geolocation is itself only
 * accurate to a few tens of metres on a phone and often far worse on desktop
 * wifi. So when the located point lands near a boundary, say so and send the
 * reader to the Secretary of State rather than asserting a district.
 */
const NEAR_LINE_M = 200;

function ringHas(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function featureHas(pt, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.some((poly) =>
    poly.length && ringHas(pt, poly[0]) && !poly.slice(1).some((h) => ringHas(pt, h)));
}

function metresToSegment(p, a, b) {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180), ky = 110540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  if (!dx && !dy) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function locatePoint(lon, lat) {
  const gj = loadedGeo[activeMapKey];
  if (!gj) return null;
  const pt = [lon, lat];
  let found = null, nearest = Infinity;
  gj.features.forEach((f) => {
    if (featureHas(pt, f.geometry)) found = districtNum(f);
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    polys.forEach((poly) => poly.forEach((ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = metresToSegment(pt, ring[i], ring[i + 1]);
        if (d < nearest) nearest = d;
      }
    }));
  });
  return { num: found, nearestMetres: nearest };
}

let youMarker = null;
function showFindMsg(html, kind) {
  const el = $("find-msg");
  el.hidden = false;
  el.className = "find-msg" + (kind ? " " + kind : "");
  el.innerHTML = html;
  /* On a phone the panel is a short scrolling sheet and the on-screen keyboard
     has just been dismissed, which leaves its scroll position anywhere. Put the
     answer back under the reader's eye rather than trusting where they landed. */
  const panel = $("panel");
  if (panel && panel.scrollHeight > panel.clientHeight) panel.scrollTop = 0;
}

const SOS = '<a href="https://teamrv-mvp.sos.texas.gov/MVP/mvp.do" target="_blank" rel="noopener">Texas My Voter Portal</a>';

function handleLocation(lon, lat, label, accuracyM) {
  const res = locatePoint(lon, lat);
  if (!res || !res.num) {
    showFindMsg(`That spot is outside Texas, so it is not in a Texas congressional district. ${label ? "" : "If you are in Texas, try typing your address or ZIP instead."}`, "err");
    return;
  }
  if (youMarker) map.removeLayer(youMarker);
  youMarker = L.circleMarker([lat, lon], {
    radius: 6, color: "#ffffff", weight: 2,
    fillColor: getVar("--accent"), fillOpacity: 1,
  }).addTo(map);

  pinnedNum = res.num;
  showDistrict(res.num, activeMapKey);
  const target = activeLayer.getLayers().find((l) => districtNum(l.feature) === res.num);
  if (target) map.fitBounds(target.getBounds(), { padding: [30, 30] });

  const where = label ? `${esc(label)} is in ` : "You are in ";
  const close = res.nearestMetres < NEAR_LINE_M || (accuracyM && accuracyM > NEAR_LINE_M);
  if (close) {
    showFindMsg(`${where}<b>District ${res.num}</b> &mdash; but this spot is about
      ${Math.round(res.nearestMetres)} m from a district line${accuracyM ? `, and the fix is only accurate to about ${Math.round(accuracyM)} m` : ""}.
      That is close enough that the district could go either way. Confirm with the ${SOS}.`, "warn");
  } else {
    showFindMsg(`${where}<b>District ${res.num}</b>. For your exact polling place and
      sample ballot, use the ${SOS}.`);
  }
}

function wireFind() {
  const btn = $("btn-locate");
  if (!navigator.geolocation) {
    btn.disabled = true;
    btn.textContent = "Location unavailable on this browser";
  }
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Locating…";
    const done = () => { btn.disabled = false; btn.textContent = "Use my location"; };
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        done();
        handleLocation(pos.coords.longitude, pos.coords.latitude, null, pos.coords.accuracy);
      },
      (err) => {
        done();
        showFindMsg(err.code === 1
          ? "Location permission was denied, so type an address or ZIP instead."
          : "Could not get a location fix. Try typing an address or ZIP.", "err");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  $("find-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("find-input").value.trim();
    if (!q) return;
    showFindMsg("Searching…");
    /* Nominatim is the only free geocoder here that allows browser requests —
       the Census one refuses CORS.

       Only add ", Texas" when the query does not already name the state:
       appending it blindly turns "Austin TX" into "Austin TX, Texas", which
       Nominatim resolves to the *University* of Texas at Austin. The viewbox
       plus bounded=1 keeps a bare street name inside Texas. */
    const named = /\b(tx|texas)\b/i.test(q);
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1" +
      "&countrycodes=us&viewbox=-106.65,36.50,-93.51,25.84&bounded=1&q=" +
      encodeURIComponent(named ? q : q + ", Texas");
    fetch(url, { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((j) => {
        if (!j.length) {
          // Nominatim cannot resolve "A & B" intersections, and that is a very
          // natural thing to type, so name the alternative rather than shrug.
          showFindMsg(/[&]|\band\b/i.test(q)
            ? "Street intersections cannot be looked up. Try a street address on one of those streets, or just your ZIP code."
            : "No match for that address. Try adding the city, or just your ZIP code.", "err");
          return;
        }
        const hit = j[0];
        handleLocation(parseFloat(hit.lon), parseFloat(hit.lat),
          (hit.display_name || q).split(",").slice(0, 3).join(","), null);
      })
      .catch(() => showFindMsg("Address lookup is unavailable right now. The " + SOS + " can look you up.", "err"));
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
wireFind();

/* There is no hover on a touch screen — telling a phone user to hover is just
   an instruction they cannot follow. */
if (!CAN_HOVER) {
  $("d-empty").textContent =
    "Tap any district on the map to see who holds it and what the 2025 redraw " +
    "did to it, then open its full guide from the button below.";
}

fetch("data/reps.json")
  .then((r) => (r.ok ? r.json() : {}))
  .then((json) => { reps = json; })
  .catch(() => { reps = {}; })
  .finally(() => { setActiveButton("2025"); renderMap("2025"); });
