/**
 * Address lookup for the Texas voting guide.
 *
 * The page needs one thing from this: turn what a reader typed into a
 * latitude and longitude, so it can work out which congressional district
 * contains them. The district maths all happens in the browser against the
 * GeoJSON the site already ships; nothing about districts lives here.
 *
 * Why it exists at all:
 *
 * 1. The Census geocoder is the right source for a US street address — it is
 *    the same address file the government uses to assign people to districts
 *    — and it flatly refuses CORS. No `access-control-allow-origin`, so a
 *    static page cannot call it. Server-side that restriction does not exist,
 *    which is the whole trick: one hop through here and the better source
 *    becomes usable.
 *
 * 2. Nominatim does allow browser requests, which is what the page used
 *    before, but it asks for no more than one request a second and a
 *    identifying User-Agent. A static page can honour neither: every reader
 *    is a separate uncoordinated client and browsers forbid setting
 *    User-Agent. Here there is one caller, one UA, and a cache.
 *
 * So: Census first for anything that looks like a street address, Nominatim
 * for bare ZIPs and fuzzier input, and a 30-day cache in front of both
 * because addresses do not move.
 *
 * It does not reshape or enrich beyond picking the first match and flattening
 * it to {lat, lon, label, source}. The two upstreams disagree about
 * everything else and the page only wants a point.
 *
 * Deploy:  cd workers/geocode && npx wrangler deploy
 *          (never from the repo root — that publishes .git)
 */

const UA = "jessestrait.com/tx-districts voting guide (contact: jessestrait.com)";

// Browsers of other sites get no header, so they cannot use this as a free
// geocoder. curl still works; that is fine, there is nothing private here.
const ALLOWED = [
  "https://jessestrait.com",
  "https://www.jessestrait.com",
  "https://jessestrait.github.io",
];

const CACHE_SECONDS = 60 * 60 * 24 * 30;

// Texas, with a little slack. Used to bias Nominatim and to reject points that
// are nowhere near the state before the page bothers doing point-in-polygon.
const TX = { w: -106.75, s: 25.7, e: -93.4, n: 36.6 };

function cors(origin) {
  const h = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${CACHE_SECONDS}`,
  };
  if (origin && ALLOWED.includes(origin)) {
    h["access-control-allow-origin"] = origin;
    h["vary"] = "origin";
  } else if (origin && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
    h["access-control-allow-origin"] = origin;   // local development
    h["vary"] = "origin";
  }
  return h;
}

const json = (body, origin, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors(origin) });

/* Census: authoritative for US street addresses, useless for a bare ZIP. */
async function census(q) {
  const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  u.searchParams.set("address", q);
  u.searchParams.set("benchmark", "Public_AR_Current");
  u.searchParams.set("format", "json");
  const r = await fetch(u, { headers: { "user-agent": UA }, cf: { cacheTtl: CACHE_SECONDS } });
  if (!r.ok) return null;
  const j = await r.json();
  const m = (j.result && j.result.addressMatches) || [];
  if (!m.length) return null;
  return {
    lat: m[0].coordinates.y,
    lon: m[0].coordinates.x,
    label: m[0].matchedAddress,
    source: "census",
  };
}

/* Nominatim: handles ZIPs, place names and vaguer input. Bounded to Texas so
   a bare street name does not land in another state. */
async function nominatim(q) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", "1");
  u.searchParams.set("countrycodes", "us");
  u.searchParams.set("viewbox", `${TX.w},${TX.n},${TX.e},${TX.s}`);
  u.searchParams.set("bounded", "1");
  u.searchParams.set("q", /\b(tx|texas)\b/i.test(q) ? q : q + ", Texas");
  const r = await fetch(u, {
    headers: { "user-agent": UA, accept: "application/json" },
    cf: { cacheTtl: CACHE_SECONDS },
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!Array.isArray(j) || !j.length) return null;
  return {
    lat: parseFloat(j[0].lat),
    lon: parseFloat(j[0].lon),
    label: (j[0].display_name || q).split(",").slice(0, 3).join(",").trim(),
    source: "nominatim",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...cors(origin),
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }
    if (request.method !== "GET") return json({ error: "GET only" }, origin, 405);

    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    if (!q) return json({ error: "missing q" }, origin, 400);

    // Serve from the edge cache before touching either upstream.
    const key = new Request(`${url.origin}/geocode?q=${encodeURIComponent(q.toLowerCase())}`,
      { method: "GET" });
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.json();
      return json({ ...body, cached: true }, origin);
    }

    // A bare ZIP goes straight to Nominatim: the Census endpoint wants a
    // street address and simply misses on five digits.
    const bareZip = /^\d{5}(-\d{4})?$/.test(q);

    let hitPoint = null;
    try {
      hitPoint = bareZip ? await nominatim(q) : ((await census(q)) || (await nominatim(q)));
    } catch (e) {
      return json({ error: "upstream unavailable" }, origin, 502);
    }

    if (!hitPoint) return json({ found: false }, origin);

    /* Deliberately no "is this in Texas" flag. The obvious implementation is a
       bounding-box test, and the box around Texas also contains Oklahoma City,
       Shreveport and a good deal of Mexico — it answered true for Oklahoma
       City, which is exactly the kind of confidently wrong answer this page
       cannot afford. The caller decides, by testing the point against the real
       district polygons it already has. */
    const body = { found: true, ...hitPoint };

    await cache.put(key, new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${CACHE_SECONDS}` },
    }));
    return json(body, origin);
  },
};
