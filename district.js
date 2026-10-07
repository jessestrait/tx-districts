/* Per-district page. Reads ?d=<1-38>&map=<2025|2021> and fills from the same
   data files the map uses, so the two pages can never disagree. */

const params = new URLSearchParams(location.search);
const num = String(parseInt(params.get("d"), 10));
const mapKey = params.get("map") === "2021" ? "2021" : "2025";
const repKey = mapKey === "2021" ? "map_2021" : "map_2025";

const GEO_NEW = "data/tx_cd120_2026.geojson";
const GEO_OLD = "data/tx_cd118_2021map.geojson";

const ELECTION_DAY = "2026-11-03";
const KEY_DATES = [
  { what: "Voter registration deadline", when: "2026-10-05", label: "Oct 5, 2026" },
  { what: "Early voting begins", when: "2026-10-19", label: "Oct 19, 2026" },
  { what: "Last day to apply for a mail ballot", when: "2026-10-23", label: "Oct 23, 2026" },
  { what: "Early voting ends", when: "2026-10-30", label: "Oct 30, 2026" },
  { what: "Election Day", when: ELECTION_DAY, label: "Nov 3, 2026" },
];

const $ = (id) => document.getElementById(id);
const getVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const PARTY_VAR = { R: "--rep", D: "--dem", L: "--lib", G: "--grn", I: "--ind" };
const partyColor = (p) => getVar(PARTY_VAR[p] || "--vacant");

/* With no incumbent on the ballot the colour is a partisan lean, not a seat
   somebody holds — say so, rather than calling an open seat "Republican". */
const partyLabel = (p, lean) =>
  p === "R" ? (lean ? "Republican-leaning" : "Republican")
  : p === "D" ? (lean ? "Democratic-leaning" : "Democrat")
  : "Vacant / unclear";

const PARTY_NAME = { R: "Republican", D: "Democrat", L: "Libertarian", G: "Green", I: "Independent" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderDates() {
  const today = new Date().toISOString().slice(0, 10);
  $("dates").innerHTML = KEY_DATES.map((d) =>
    `<div class="date-row${d.when < today ? " past" : ""}">
       <span>${d.what}</span><span class="when">${d.label}</span></div>`).join("");
}

function flagFor(reps) {
  const flags = (reps.sourcing_flags || {}).weak_or_conflicting || [];
  return flags.find((f) => new RegExp("^" + num + "\\b|^" + num + "[/ (]").test(f.trim())) || null;
}

function renderHeader(reps) {
  const info = ((reps || {})[repKey] || {})[num];
  document.title = `Texas District ${num} — 2026 Voting Guide`;
  $("page-title").textContent = `Texas District ${num}`;
  $("d-num").textContent = `District ${num}`;
  $("mapname").textContent = mapKey === "2021"
    ? "2021 map — used 2022 & 2024" : "2026 map — governs Nov 3";

  const party = info ? info.party : null;
  const name = info ? (mapKey === "2021" ? info.rep : info.incumbent_or_favored) : null;
  $("d-party").innerHTML =
    `<span class="dot" style="background:${partyColor(party)}"></span>${partyLabel(party, !name)}`;
  $("d-rep").textContent = name || (info ? "No incumbent running" : "Data unavailable");
  $("d-status").textContent = !info ? ""
    : mapKey === "2021"
      ? (info.first_elected ? `In office since ${info.first_elected} · 2021 map` : "2021 map")
      : (info.status || "");
  $("d-notes").textContent = (info && info.notes) || "No notes recorded for this district.";

  const flag = flagFor(reps);
  $("d-flag").hidden = !flag;
  if (flag) $("d-flag").textContent = "Sourcing note: " + flag;

  return party;
}

function renderFigures(party) {
  const color = partyColor(party);
  Promise.all([
    fetch(GEO_NEW).then((r) => r.json()),
    fetch(GEO_OLD).then((r) => r.json()),
  ]).then(([gjNew, gjOld]) => {
    // The page always draws the current (2026) geography for the locator, since
    // that is the district a reader is about to vote in.
    drawLocator($("fig-locator"), gjNew, num, color);
    drawShape($("fig-shape"), gjNew, gjOld, num, color);
    $("cap-locator").textContent = `District ${num} highlighted among all 38 Texas districts, on the map governing the Nov 3, 2026 election.`;
    $("cap-shape").innerHTML =
      `<span class="key"><span class="solid" style="background:${color}"></span>2026 lines</span>` +
      `<span class="key"><span class="dash"></span>2021 lines</span><br>` +
      `Both outlines are District ${num}. Where they differ is what the August 2025 redraw changed.`;
  }).catch(() => {
    $("cap-locator").textContent = "District outline unavailable.";
  });
}

/* ── ballot ── */
function ratingClass(r) {
  if (/Safe|Solid/.test(r)) return r.endsWith("D") ? "safe-d" : "safe-r";
  return "close";
}

function candRow(c) {
  return `<div class="cand">
    <span class="dot" style="background:${partyColor(c.party)}"></span>
    <span class="nm">${esc(c.name)}</span>
    <span class="pty">${esc(PARTY_NAME[c.party] || c.party || "")}</span>
    ${c.incumbent ? '<span class="inc">Incumbent</span>' : ""}
    ${c.note ? `<div class="cnote">${esc(c.note)}</div>` : ""}
  </div>`;
}

function renderBallot(house, statewide) {
  const el = $("ballot");
  let html = "";

  const hd = house && house.districts ? house.districts[num] : null;
  if (hd && hd.candidates && hd.candidates.length) {
    html += `<div class="race">
      <div class="office">U.S. House &mdash; District ${num}
        ${hd.rating ? `<span class="rating ${ratingClass(hd.rating)}">${esc(hd.rating)}</span>` : ""}</div>
      <div class="explain">One of 435 seats in the U.S. House of Representatives. Members serve two-year terms, write and vote on federal law, and control federal spending. This is the race the district lines on this page decide.</div>
      ${hd.candidates.map(candRow).join("")}
      ${hd.race_note ? `<div class="explain" style="margin:.75rem 0 0">${esc(hd.race_note)}</div>` : ""}
      ${hd.rating ? `<div class="explain" style="margin:.5rem 0 0">Forecasters rate this seat <b>${esc(hd.rating)}</b> &mdash; a prediction of how competitive the race is, not a ballot fact and not a result. ${/Safe|Solid/.test(hd.rating) ? "A safe rating means the seat is not expected to change hands." : "A close rating means the outcome is genuinely in play."}</div>` : ""}
    </div>`;
  }

  if (statewide && statewide.offices) {
    statewide.offices.forEach((o) => {
      html += `<div class="race">
        <div class="office">${esc(o.office)}</div>
        ${o.what_it_does ? `<div class="explain">${esc(o.what_it_does)}</div>` : ""}
        ${(o.candidates || []).map(candRow).join("")}
      </div>`;
    });
  }

  if (statewide && statewide.propositions && statewide.propositions.length) {
    statewide.propositions.forEach((p) => {
      html += `<div class="race">
        <div class="office">${esc(p.number)}</div>
        <div class="explain">${esc(p.plain_english || "")}</div>
        <div class="yesno">
          <div class="y"><b>A YES vote</b>${esc(p.yes_means || "")}</div>
          <div class="n"><b>A NO vote</b>${esc(p.no_means || "")}</div>
        </div>
        ${p.official_text ? `<details class="jargon">
          <summary>Read the official ballot wording</summary>
          <div class="official">${esc(p.official_text)}</div>
        </details>` : ""}
      </div>`;
    });
  } else if (statewide && statewide.propositions_note) {
    html += `<div class="pending">${esc(statewide.propositions_note)}</div>`;
  }

  if (!html) {
    html = `<div class="pending">
      Ballot data is still being compiled for this district. In the meantime, the
      Texas Secretary of State's
      <a href="https://teamrv-mvp.sos.texas.gov/MVP/mvp.do" target="_blank" rel="noopener">My Voter Portal</a>
      shows your exact sample ballot, including the local races and any city,
      county or school-district measures that this page does not cover.
    </div>`;
  } else {
    html += `<p class="muted" style="margin-top:.9rem">
      This covers the federal and statewide races every voter in District ${num}
      sees. It does not include city, county, school-district or other local
      items, which vary street by street &mdash; your
      <a href="https://teamrv-mvp.sos.texas.gov/MVP/mvp.do" target="_blank" rel="noopener">sample ballot</a>
      is the complete list.</p>`;
  }
  el.innerHTML = html;
}

/* ── boot ── */
renderDates();

if (!num || num === "NaN" || +num < 1 || +num > 38) {
  $("d-num").textContent = "District not found";
  $("d-status").textContent = "Pick a district from the map.";
} else {
  const j = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([j("data/reps.json"), j("data/ballot_house.json"), j("data/ballot_statewide.json")])
    .then(([reps, house, statewide]) => {
      const party = renderHeader(reps || {});
      renderFigures(party);
      renderBallot(house, statewide);
    });
}
