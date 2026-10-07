/* Inline-SVG district drawing, straight from the same GeoJSON the map uses.
 *
 * No tiles and no Leaflet on this page: the shapes are the point here, and an
 * SVG of a single district is a few KB against a basemap's worth of requests.
 *
 * Texas is small enough and far enough from the poles that a plate carrée with
 * the x axis scaled by cos(centre latitude) is visually square — a real conic
 * projection would be more correct and nobody would be able to see it.
 */

function projector(lat0) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return (lon, lat) => [lon * k, -lat];
}

function geomRings(geom) {
  if (!geom) return [];
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const out = [];
  polys.forEach((poly) => poly.forEach((ring) => out.push(ring)));
  return out;
}

function boundsOf(features) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  features.forEach((f) => geomRings(f.geometry).forEach((ring) => ring.forEach((c) => {
    if (c[0] < minx) minx = c[0];
    if (c[0] > maxx) maxx = c[0];
    if (c[1] < miny) miny = c[1];
    if (c[1] > maxy) maxy = c[1];
  })));
  return { minx, miny, maxx, maxy };
}

/* Build a path string for one feature, in a fitted coordinate space. */
function pathFor(feature, fit) {
  let d = "";
  geomRings(feature.geometry).forEach((ring) => {
    // Rings on a simplified statewide file can be a handful of points; drop the
    // degenerate ones rather than emitting slivers.
    if (ring.length < 4) return;
    ring.forEach((c, i) => {
      const [x, y] = fit(c[0], c[1]);
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    });
    d += "Z";
  });
  return d;
}

/* Returns fit(lon,lat)->[x,y] mapping the given bounds into w x h with padding. */
function fitter(bounds, w, h, pad) {
  const lat0 = (bounds.miny + bounds.maxy) / 2;
  const proj = projector(lat0);
  const [x0, y1] = proj(bounds.minx, bounds.miny);
  const [x1, y0] = proj(bounds.maxx, bounds.maxy);
  const sx = (w - pad * 2) / (x1 - x0);
  const sy = (h - pad * 2) / (y1 - y0);
  const s = Math.min(sx, sy);
  const ox = pad + ((w - pad * 2) - (x1 - x0) * s) / 2;
  const oy = pad + ((h - pad * 2) - (y1 - y0) * s) / 2;
  return (lon, lat) => {
    const [px, py] = proj(lon, lat);
    return [ox + (px - x0) * s, oy + (py - y0) * s];
  };
}

function svgEl(w, h) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("width", "100%");
  s.setAttribute("role", "img");
  return s;
}

function addPath(svg, d, attrs) {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  Object.entries(attrs).forEach(([k, v]) => p.setAttribute(k, v));
  svg.appendChild(p);
  return p;
}

/* ── Locator: all 38 districts faint, this one lit up. ── */
function drawLocator(el, gj, num, color) {
  const W = 420, H = 300;
  const fit = fitter(boundsOf(gj.features), W, H, 8);
  const svg = svgEl(W, H);
  svg.setAttribute("aria-label", `Where District ${num} sits in Texas`);

  let others = "", mine = "";
  const mineFeatures = [];
  gj.features.forEach((f) => {
    const d = pathFor(f, fit);
    if (districtOf(f) === num) { mine += d; mineFeatures.push(f); } else others += d;
  });
  addPath(svg, others, { fill: "#131c2b", stroke: "#1e2a3a", "stroke-width": 0.6 });
  addPath(svg, mine, { fill: color, stroke: "#e8eef8", "stroke-width": 1.4, "fill-opacity": 0.85 });

  /* The urban districts are a few pixels across at statewide scale — Dallas and
     Houston seats vanish entirely against the big rural ones. Ring anything too
     small to pick out, so "where is it" is answerable at a glance. */
  if (mineFeatures.length) {
    const b = boundsOf(mineFeatures);
    const [x0, y0] = fit(b.minx, b.maxy);
    const [x1, y1] = fit(b.maxx, b.miny);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const diag = Math.hypot(x1 - x0, y1 - y0);
    if (diag < W * 0.18) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", cx.toFixed(1));
      c.setAttribute("cy", cy.toFixed(1));
      c.setAttribute("r", Math.max(16, diag * 0.8).toFixed(1));
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", "#e8eef8");
      c.setAttribute("stroke-width", "1.5");
      c.setAttribute("stroke-opacity", "0.75");
      svg.appendChild(c);
    }
  }

  el.innerHTML = "";
  el.appendChild(svg);
}

/* ── Shape: this district big, with the old same-numbered district ghosted
   behind it so the redraw is visible rather than described. ── */
function drawShape(el, gjNew, gjOld, num, color) {
  const W = 420, H = 300;
  const mineNew = gjNew.features.filter((f) => districtOf(f) === num);
  const mineOld = (gjOld ? gjOld.features : []).filter((f) => districtOf(f) === num);
  if (!mineNew.length) { el.innerHTML = ""; return; }

  // Fit to both outlines together, so the movement between them is to scale.
  const fit = fitter(boundsOf(mineNew.concat(mineOld)), W, H, 10);
  const svg = svgEl(W, H);
  svg.setAttribute("aria-label", `Shape of District ${num}, with its previous boundary`);

  if (mineOld.length) {
    addPath(svg, mineOld.map((f) => pathFor(f, fit)).join(""), {
      fill: "none", stroke: "#7a8fa8", "stroke-width": 1.2,
      "stroke-dasharray": "5 4", "stroke-opacity": 0.85,
    });
  }
  addPath(svg, mineNew.map((f) => pathFor(f, fit)).join(""), {
    fill: color, "fill-opacity": 0.5, stroke: color, "stroke-width": 1.8,
  });

  el.innerHTML = "";
  el.appendChild(svg);
}

function districtOf(f) {
  return String(parseInt((f.properties.GEOID || "").replace(/\D/g, "").slice(-2), 10));
}
