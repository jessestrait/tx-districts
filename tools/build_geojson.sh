#!/usr/bin/env bash
# Rebuild the two district GeoJSONs.
#
#   2021 map — Census TIGER/Line TIGER2023 CD118. Enacted 2021, used in the
#              2022 and 2024 elections. The "before" map.
#   2026 map — Census TIGERweb, "120th Congressional Districts" layer. The map
#              the legislature redrew in Aug 2025 and SCOTUS let stand. The
#              "after" map, the one governing the Nov 3 2026 election.
#
# THE TRAP, and it is a good one: do NOT use CD119 for the new map. The 119th
# Congress was *elected* in Nov 2024, under the old lines — so the CD119 file
# carries the 2021 map even though Census reissued it in Sept 2025, after the
# redistricting. The new lines first elect a Congress in Nov 2026: the 120th.
# Using CD119 gives you two byte-different copies of the *same map* — every
# district's area identical to four decimals — and a toggle that appears to
# work because the labels change while the geometry does not.
#
# As of this writing there is no CD120 file in the TIGER/Line download tree at
# all; TIGERweb's live service is where that geometry exists. If a
# tl_<year>_48_cd120.zip ever appears under www2.census.gov/geo/tiger/, it is
# the simpler source and this script should switch to it.
#
# Needs: curl, unzip, npx (mapshaper is fetched on demand).

set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

TIGERWEB="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query"

echo "→ 2026 map: TIGERweb 120th Congressional Districts, Texas"
curl -sSf --max-time 300 -G "$TIGERWEB" \
  --data-urlencode "where=STATE='48'" \
  --data-urlencode "outFields=GEOID,BASENAME,NAME,CD120" \
  --data-urlencode "returnGeometry=true" \
  --data-urlencode "outSR=4326" \
  --data-urlencode "f=geojson" \
  -o data/raw/cd120_tigerweb.geojson

# Guard: the layer pages at 1000 features, far above Texas's 38, but a silent
# truncation here would quietly drop districts off the map.
python3 - <<'PY'
import json, sys
d = json.load(open("data/raw/cd120_tigerweb.geojson"))
n = len(d.get("features", []))
if n != 38:
    sys.exit(f"expected 38 Texas districts from TIGERweb, got {n}")
print(f"   got {n} districts")
PY

echo "→ 2021 map: TIGER/Line TIGER2023 CD118"
curl -sSf --max-time 300 -o data/raw/cd118_2021map.zip \
  https://www2.census.gov/geo/tiger/TIGER2023/CD/tl_2023_48_cd118.zip
unzip -o -q data/raw/cd118_2021map.zip -d data/raw/cd118_2021map

# 8% Douglas-Peucker keeps the districts recognisable at statewide zoom while
# dropping each file to ~600 KB. keep-shapes stops the thin river-tracing
# districts collapsing to nothing.
echo "→ simplifying"
npx --yes mapshaper data/raw/cd120_tigerweb.geojson \
  -simplify dp 8% keep-shapes -clean \
  -o data/tx_cd120_2026.geojson format=geojson precision=0.0001

npx --yes mapshaper data/raw/cd118_2021map/tl_2023_48_cd118.shp \
  -proj wgs84 -simplify dp 8% keep-shapes -clean \
  -o data/tx_cd118_2021map.geojson format=geojson precision=0.0001

# Guard: if these two ever come out as the same map again, say so loudly.
python3 - <<'PY'
import json
def areas(path, ):
    gj = json.load(open(path)); out = {}
    for f in gj["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        s = 0
        for poly in polys:
            r = poly[0]
            s += abs(sum(r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1] for i in range(len(r)-1)))/2
        out[int(f["properties"]["GEOID"][-2:])] = s
    return out
a = areas("data/tx_cd118_2021map.geojson"); b = areas("data/tx_cd120_2026.geojson")
moved = [n for n in a if abs(b[n]-a[n])/a[n] > 0.01]
print(f"   {len(moved)}/38 districts differ by >1% area between the two maps")
if len(moved) < 20:
    raise SystemExit("ABORT: the two maps look like the same map. Check the CD vintage.")
PY

echo "→ done"
ls -la data/tx_cd*.geojson
