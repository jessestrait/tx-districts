#!/usr/bin/env python3
"""Build the animated card thumbnail: the district lines snapping between the
2021 map and the 2026 one.

Drawn straight from the same GeoJSON the site ships, in the same neon palette,
so the card cannot drift away from the thing it advertises. Pillow only — no
browser, no headless screenshot to go stale.

    python3 tools/make_card_gif.py [out.gif]
"""

import json, math, sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEW = os.path.join(HERE, "data/tx_cd120_2026.geojson")
OLD = os.path.join(HERE, "data/tx_cd118_2021map.geojson")
REPS = os.path.join(HERE, "data/reps.json")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "card.gif")

W, H = 640, 360                      # 16:9, card-sized
SS = 2                               # supersample, then downscale for clean edges
BG = (4, 6, 15)
REP, DEM, VAC = (255, 46, 99), (46, 123, 255), (90, 106, 138)
CYAN = (0, 212, 255)
TEXT = (230, 243, 255)

FADE = 7                             # crossfade steps between the two maps
HOLD_MS, STEP_MS = 1400, 55          # dwell on each map, and per crossfade step


def rings(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return [r for poly in polys for r in poly]


def bounds(features):
    xs0 = ys0 = 1e9; xs1 = ys1 = -1e9
    for f in features:
        for r in rings(f["geometry"]):
            for c in r:
                xs0 = min(xs0, c[0]); xs1 = max(xs1, c[0])
                ys0 = min(ys0, c[1]); ys1 = max(ys1, c[1])
    return xs0, ys0, xs1, ys1


def load(path):
    return json.load(open(path))["features"]


def dnum(f):
    return str(int(f["properties"]["GEOID"][-2:]))


def make_fit(all_feats, w, h, pad):
    x0, y0, x1, y1 = bounds(all_feats)
    lat0 = (y0 + y1) / 2
    k = math.cos(math.radians(lat0))
    px0, px1 = x0 * k, x1 * k
    s = min((w - 2 * pad) / (px1 - px0), (h - 2 * pad) / (y1 - y0))
    ox = pad + ((w - 2 * pad) - (px1 - px0) * s) / 2
    oy = pad + ((h - 2 * pad) - (y1 - y0) * s) / 2
    def fit(lon, lat):
        return (ox + (lon * k - px0) * s, oy + (y1 - lat) * s)
    return fit


def party_of(reps, key, d):
    return (reps[key].get(d) or {}).get("party")


def render(features, reps, repkey, fit, label):
    """One map, supersampled, with a bloom pass so the lines read as lit."""
    base = Image.new("RGB", (W * SS, H * SS), BG)
    dr = ImageDraw.Draw(base)

    for f in features:
        col = {"R": REP, "D": DEM}.get(party_of(reps, repkey, dnum(f)), VAC)
        for r in rings(f["geometry"]):
            if len(r) < 4:
                continue
            pts = [fit(c[0], c[1]) for c in r]
            pts = [(x * SS, y * SS) for x, y in pts]
            dr.polygon(pts, fill=tuple(int(c * 0.34) for c in col))
            dr.line(pts + [pts[0]], fill=col, width=max(1, SS))

    # bloom: blur a copy and screen it back over, which is what sells "neon"
    glow = base.filter(ImageFilter.GaussianBlur(radius=4 * SS))
    base = Image.blend(base, Image.eval(glow, lambda v: min(255, int(v * 1.5))), 0.42)

    img = base.resize((W, H), Image.LANCZOS)
    draw = ImageDraw.Draw(img)

    def font(sz):
        for p in ("/System/Library/Fonts/Supplemental/Futura.ttc",
                  "/System/Library/Fonts/HelveticaNeue.ttc",
                  "/System/Library/Fonts/Supplemental/Arial.ttf"):
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, sz)
                except Exception:
                    pass
        return ImageFont.load_default()

    draw.text((18, 14), "2026 TEXAS VOTING GUIDE", font=font(19), fill=TEXT)
    # the year chip is the thing that makes the swap legible at card size
    chip = font(30)
    tw = draw.textbbox((0, 0), label, font=chip)
    bx, by = 18, H - 54
    draw.rounded_rectangle([bx - 6, by - 6, bx + (tw[2] - tw[0]) + 14, by + (tw[3] - tw[1]) + 16],
                           radius=7, fill=(10, 16, 32), outline=CYAN, width=2)
    draw.text((bx + 4, by - 2), label, font=chip, fill=CYAN)
    return img


def main():
    new, old = load(NEW), load(OLD)
    reps = json.load(open(REPS))
    fit = make_fit(new + old, W, H, 26)

    a = render(old, reps, "map_2021", fit, "2021")
    b = render(new, reps, "map_2025", fit, "2026")

    # Hold with a long per-frame duration rather than repeating a frame: GIF
    # optimisation collapses identical consecutive frames, which would turn an
    # intended one-second hold into a 90ms flicker.
    frames, durations = [], []
    frames.append(a); durations.append(HOLD_MS)
    for i in range(1, FADE + 1):
        frames.append(Image.blend(a, b, i / (FADE + 1))); durations.append(STEP_MS)
    frames.append(b); durations.append(HOLD_MS)
    for i in range(1, FADE + 1):
        frames.append(Image.blend(b, a, i / (FADE + 1))); durations.append(STEP_MS)

    pal = [f.convert("P", palette=Image.ADAPTIVE, colors=128) for f in frames]
    pal[0].save(OUT, save_all=True, append_images=pal[1:], duration=durations,
                loop=0, optimize=True, disposal=2)
    print("wrote %s  (%d frames, %.0f KB, cycle %.1fs)"
          % (OUT, len(pal), os.path.getsize(OUT) / 1024, sum(durations) / 1000))


if __name__ == "__main__":
    main()
