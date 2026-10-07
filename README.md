# Texas Congressional Districts

An interactive dark-mode map of all 38 Texas U.S. House districts, coloured by
the party holding the seat, with a toggle between the map Texas used in 2022
and 2024 and the map that governs the November 2026 election.

Live at **[jessestrait.com/tx-districts/](https://jessestrait.com/tx-districts/)**.

There is **no build step**. The HTML, JS and GeoJSON in this repo are the files
the browser gets. Edit them directly.

## Why there are two maps

Texas redrew its congressional map in August 2025, mid-decade, in a move that
targeted five Democratic-held seats. A district court found it an
unconstitutional racial gerrymander in October 2025; the Supreme Court stayed
that ruling in December 2025, so **the 2025 map is the one being voted on in
November 2026**.

That makes the before/after comparison the actual point of this page, not a
footnote — the toggle is there so a reader can see which lines moved around
them and what it did to their district.

## Layout

```
index.html              the page — header, legend, tally
city.js                 Leaflet map, both layers, hover tooltips, the toggle
data/tx_cd119_2025.geojson    the 2025 map (governs the 2026 election)
data/tx_cd118_2021map.geojson the 2021 map (used 2022 & 2024)
data/reps.json          district → representative, party, status, notes
tools/build_geojson.sh  rebuilds both GeoJSONs from Census TIGER/Line
data/raw/               TIGER downloads, gitignored, rebuildable
```

## Data sources

- **Boundaries** — US Census Bureau TIGER/Line. The 2021 map is the TIGER2023
  `CD118` file; the 2025 map is the TIGER2025 `CD119` file, reissued after the
  August 2025 redistricting.

  **The trap:** TIGER2024's `CD119` file *predates* the redistricting and still
  carries the old 2021 lines under a `119` label. Pull `CD119` from the wrong
  year and you silently get two copies of the same map, with a toggle that
  appears to do nothing. `tools/build_geojson.sh` pins the right vintages.

- **Representatives and party** — see `sources` in `data/reps.json`.

District numbers come from the GeoID's last two digits (`4801` → district 1).
`reps.json` keys match that as plain `"1"`–`"38"`, no leading zero.

## Running it locally

```bash
python3 -m http.server 8799
```

Then open `http://localhost:8799/`.

## Gotchas

- **`fitBounds` on load is a race.** Leaflet caches the container size, and the
  GeoJSON fetch can resolve before the container has real dimensions. A
  zero-height container makes `fitBounds` clamp to `maxZoom` and land you on a
  blank patch of rural Texas. `city.js` re-fits on `resize` until the reader
  pans or zooms themselves; `invalidateSize()` alone does not fix it, because
  at that instant the container is still collapsed.
- **Keep the two maps' district numbering straight.** A district number means
  different geography on either side of the toggle. That is the whole point,
  and it is also the easiest thing to get subtly wrong.
