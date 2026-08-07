#!/usr/bin/env python3
"""Build a card-stepper flow graphic (SVG) from a JSON spec, dark or light.

Usage:
    python3 build_graphic.py spec.json out.svg [--mode dark|light|both]

`both` (the default) writes out.svg and out-light.svg in one pass, so the two
themes never drift apart.

Spec shape (see reference/spec.md for the full contract):

    {
      "title":    "The plan is where humans decide",
      "subtitle": "Eight steps of `/plan` — every answer written to disk",
      "columns":  4,
      "savedLabel": "SAVED TO DISK",
      "theme":    {"from": "#35d6e8", "to": "#b06bf5"},
      "themeLight": {"from": "#0e93ad", "to": "#7c3aed"},
      "cards": [
        {
          "title":   "RECORD THE FACTS",
          "tag":     {"label": "the engine", "tone": "to"},
          "bullets": ["Inspect the code and files relevant to the request"],
          "note":    "Ensures the plan reflects the repository's current state",
          "savedLabel": "SAVED WHEN NOTES EXIST",
          "saved":   [".lightsout/plans/<name>/facts.json"]
        }
      ],
      "banner": "Every decision settled here is a decision no agent guesses."
    }

Backticks switch to the mono face in titles, bullets and notes. A `saved` line
starting with "—", "or ", "nothing", "failed", or "…" renders dim as an
annotation rather than a path. Bullets and notes wrap automatically.
"""

import colorsys
import json
import re
import sys
from xml.sax.saxutils import escape

# ---------------------------------------------------------------- geometry --
M = 90        # outer margin
CW = 500      # card width
GAP_X = 65    # column gap (holds the arrow)
GAP_Y = 82    # row gap (holds the wrap connector)
HEADER = 236  # top band: title, subtitle, hairline
BANNER_H = 76
SANS = "Helvetica Neue, Helvetica, Arial, sans-serif"
MONO = "Menlo, SF Mono, monospace"

# Card internals, all measured from the card's top-left.
PAD = 28
BADGE_CY = 46
TITLE_Y = 112
TITLE_SIZE = 26
RULE_Y = 126
BULLET_X = PAD + 22
BULLET_Y = 164      # first bullet baseline
BULLET_SIZE = 19
BULLET_LINE_DY = 28  # between wrapped lines of one bullet
BULLET_GAP = 7       # extra space between bullets
NOTE_TOP_GAP = 34    # from the last bullet line to the note's first line
NOTE_SIZE = 16.5
NOTE_LINE_DY = 25
BAND_GAP = 40        # from the last content line to the divider
SAVED_DY = 24        # between artifact lines
BOTTOM_PAD = 34

# Average glyph width as a fraction of font size, per face. Text is estimated,
# never measured — check the render when labels run long.
EM_SANS = 0.50
EM_CAPS = 0.62   # bold uppercase card titles
EM_MONO = 0.60

# ---------------------------------------------------------------- palettes --
# Body text is near-white on dark and near-black on light. Dark backgrounds
# tempt you toward muted greys; they collapse the moment a page scales the
# image down. Only the why-line and annotations rank below the body text.
PALETTE = {
    "dark": {
        "bg": ("#0d1524", "#070a12", "#04060b"),
        "cardFill": "#0a0f1a",
        "cardOpacity": "0.92",
        "cardHalo": "0.16",
        "edge": ("0.85", "0.35"),
        "headline": ("#e9f6ff", "#cdb8ff"),
        "cardTitle": "#f1f5fb",
        "body": "#f0f5fd",
        "note": "#c2d1e6",
        "subtitle": "#c3d3e8",
        "tagLabel": "#eef4fb",
        "mono": "#f6faff",
        "monoDim": "#c6d5e8",
        "inlineMono": "#cdf0fa",
        "dots": ("#5b7bb0", "0.16"),
        "accents": ("#35d6e8", "#b06bf5"),
        "lift": "glow",   # neon bloom behind the banner
    },
    "light": {
        "bg": ("#ffffff", "#f7f9fd", "#eaeff8"),
        "cardFill": "#ffffff",
        "cardOpacity": "0.97",
        "cardHalo": "0.10",
        "edge": ("0.75", "0.28"),
        "headline": ("#101a2b", "#6d28d9"),
        "cardTitle": "#0d1626",
        "body": "#26344a",
        "note": "#5d6c85",
        "subtitle": "#4c5a72",
        "tagLabel": "#33415a",
        "mono": "#152233",
        "monoDim": "#67758d",
        "inlineMono": "#0e7490",
        "dots": ("#94a3b8", "0.35"),
        "accents": None,   # derived from the dark theme unless themeLight is set
        "lift": "shadow",  # soft drop shadow; a neon glow reads as a smudge here
    },
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return "#%02x%02x%02x" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def for_light(hex_color):
    """Re-tune a dark-mode accent for white: same hue, enough darkness to read.

    A neon that sings on near-black is invisible on white. Dropping lightness
    to ~0.42 and keeping saturation high preserves the identity of the ramp
    while restoring contrast.
    """
    r, g, b = (c / 255 for c in hex_to_rgb(hex_color))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, min(l, 0.42), min(1.0, s * 1.05))
    return "#%02x%02x%02x" % tuple(round(c * 255) for c in (r, g, b))


def wrap(text, width_px, size, em=EM_SANS):
    """Greedy wrap on an estimated glyph width.

    Backticks survive the wrap (they carry the mono styling downstream) but do
    not count toward the measured width, and a backticked span is never split.
    """
    limit = max(8, int(width_px / (size * em)))
    lines, cur, cur_len = [], "", 0
    for word in text.split(" "):
        wlen = len(plain(word))
        if cur and cur_len + 1 + wlen > limit:
            lines.append(cur)
            cur, cur_len = word, wlen
        else:
            cur = f"{cur} {word}".strip()
            cur_len = cur_len + 1 + wlen if cur_len else wlen
    if cur:
        lines.append(cur)
    return lines


def rich(text, p):
    """Backtick spans render in the mono face, tinted."""
    parts = re.split(r"`([^`]*)`", text)
    return "".join(
        escape(s) if i % 2 == 0
        else f'<tspan font-family="{MONO}" fill="{p["inlineMono"]}">{escape(s)}</tspan>'
        for i, s in enumerate(parts)
    )


def plain(text):
    """Text as measured — backticks are delimiters, not glyphs."""
    return text.replace("`", "")


def layout(card):
    """Wrapped lines and the y of the last content line, for one card."""
    bullets = [wrap(b, CW - BULLET_X - PAD, BULLET_SIZE) for b in card.get("bullets", [])]
    note = wrap(card["note"], CW - 2 * PAD, NOTE_SIZE) if card.get("note") else []

    y = BULLET_Y
    placed = []
    for i, lines in enumerate(bullets):
        placed.append((y, lines))
        y += BULLET_LINE_DY * len(lines) + (BULLET_GAP if i < len(bullets) - 1 else 0)
    last = y - (BULLET_LINE_DY if bullets else 0)

    note_y = last + NOTE_TOP_GAP if note else None
    if note:
        last = note_y + NOTE_LINE_DY * (len(note) - 1)

    return placed, note, note_y, last


def resolve_accents(spec, mode):
    """The gradient endpoints for this mode, honouring per-mode overrides."""
    dark = spec.get("theme", {})
    d_from = dark.get("from", PALETTE["dark"]["accents"][0])
    d_to = dark.get("to", PALETTE["dark"]["accents"][1])
    if mode == "dark":
        return d_from, d_to
    light = spec.get("themeLight", {})
    return light.get("from", for_light(d_from)), light.get("to", for_light(d_to))


def build(spec, mode="dark"):
    p = PALETTE[mode]
    cards = spec["cards"]
    cols = spec.get("columns", 3)
    n = len(cards)
    rows = (n + cols - 1) // cols
    hex_from, hex_to = resolve_accents(spec, mode)
    c_from, c_to = hex_to_rgb(hex_from), hex_to_rgb(hex_to)
    banner = spec.get("banner")
    default_saved_label = spec.get("savedLabel", "SAVED TO DISK")

    accent = [mix(c_from, c_to, i / max(1, n - 1)) for i in range(n)]
    laid = [layout(c) for c in cards]

    # Uniform card height, driven by the fullest card.
    content_end = max(l[3] for l in laid)
    max_s = max(len(c.get("saved", [])) for c in cards)
    CH = content_end + BAND_GAP + 50 + SAVED_DY * (max_s - 1) + BOTTOM_PAD

    W = M * 2 + CW * cols + GAP_X * (cols - 1)
    H = HEADER + CH * rows + GAP_Y * (rows - 1) + (118 + BANNER_H if banner else 70)

    o = []
    a = o.append
    a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
      f'viewBox="0 0 {W} {H}" font-family="{SANS}">')

    # -- defs --
    a('<defs>')
    a(f'<radialGradient id="bg" cx="50%" cy="0%" r="120%">'
      f'<stop offset="0%" stop-color="{p["bg"][0]}"/>'
      f'<stop offset="55%" stop-color="{p["bg"][1]}"/>'
      f'<stop offset="100%" stop-color="{p["bg"][2]}"/></radialGradient>')
    a(f'<linearGradient id="title" x1="0" y1="0" x2="1" y2="0">'
      f'<stop offset="0%" stop-color="{p["headline"][0]}"/>'
      f'<stop offset="100%" stop-color="{p["headline"][1]}"/></linearGradient>')
    a(f'<linearGradient id="rail" x1="0" y1="0" x2="1" y2="0">'
      f'<stop offset="0%" stop-color="{hex_from}" stop-opacity="0"/>'
      f'<stop offset="18%" stop-color="{hex_from}" stop-opacity="0.85"/>'
      f'<stop offset="82%" stop-color="{hex_to}" stop-opacity="0.85"/>'
      f'<stop offset="100%" stop-color="{hex_to}" stop-opacity="0"/></linearGradient>')
    for i in range(n):
        t0 = i / max(1, n - 1)
        t1 = min(1.0, t0 + 0.16)
        a(f'<linearGradient id="edge{i}" x1="0" y1="0" x2="1" y2="1">'
          f'<stop offset="0%" stop-color="{mix(c_from, c_to, t0)}" stop-opacity="{p["edge"][0]}"/>'
          f'<stop offset="100%" stop-color="{mix(c_from, c_to, t1)}" stop-opacity="{p["edge"][1]}"/></linearGradient>')
        a(f'<linearGradient id="rule{i}" x1="0" y1="0" x2="1" y2="0">'
          f'<stop offset="0%" stop-color="{accent[i]}" stop-opacity="0.95"/>'
          f'<stop offset="100%" stop-color="{accent[i]}" stop-opacity="0"/></linearGradient>')
    if p["lift"] == "glow":
        a('<filter id="lift" x="-60%" y="-60%" width="220%" height="220%">'
          '<feGaussianBlur stdDeviation="9" result="b"/>'
          '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    else:
        a('<filter id="lift" x="-30%" y="-30%" width="160%" height="180%">'
          '<feGaussianBlur in="SourceAlpha" stdDeviation="7"/>'
          '<feOffset dy="5" result="s"/>'
          '<feFlood flood-color="#2b3a55" flood-opacity="0.18"/>'
          '<feComposite in2="s" operator="in"/>'
          '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    a(f'<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">'
      f'<circle cx="1.5" cy="1.5" r="1.1" fill="{p["dots"][0]}" fill-opacity="{p["dots"][1]}"/></pattern>')
    a('</defs>')

    # -- background --
    a(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    a('<rect x="0" y="0" width="260" height="180" fill="url(#dots)"/>')
    a(f'<rect x="{W-260}" y="{H-180}" width="260" height="180" fill="url(#dots)"/>')

    # -- header --
    a(f'<text x="{W/2}" y="106" text-anchor="middle" font-size="62" font-weight="700" '
      f'letter-spacing="-0.5" fill="url(#title)">{rich(spec["title"], p)}</text>')
    if spec.get("subtitle"):
        a(f'<text x="{W/2}" y="152" text-anchor="middle" font-size="25" fill="{p["subtitle"]}">'
          f'{rich(spec["subtitle"], p)}</text>')
    a(f'<rect x="{W/2-330}" y="180" width="660" height="2" fill="url(#rail)"/>')

    positions = []
    for i in range(n):
        r, c = divmod(i, cols)
        positions.append((M + c * (CW + GAP_X), HEADER + r * (CH + GAP_Y)))

    # -- connectors (drawn first, so cards sit on top) --
    for i in range(n - 1):
        _, c = divmod(i, cols)
        x, y = positions[i]
        col = mix(c_from, c_to, (i + 0.5) / max(1, n - 1))
        if c < cols - 1:
            ax, ay = x + CW + 9, y + CH / 2
            a(f'<g><line x1="{ax}" y1="{ay}" x2="{ax+38}" y2="{ay}" stroke="{col}" '
              f'stroke-opacity="0.55" stroke-width="2"/>'
              f'<path d="M{ax+34},{ay-6} L{ax+46},{ay} L{ax+34},{ay+6}" fill="none" stroke="{col}" '
              f'stroke-opacity="0.85" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>')
        else:
            nx, ny = positions[i + 1]
            y1, y2, y3 = y + CH / 2, y + CH + GAP_Y / 2, ny + CH / 2
            a(f'<path d="M{x+CW+8},{y1} H{W-34} Q{W-20},{y1} {W-20},{y1+14} V{y2-14} '
              f'Q{W-20},{y2} {W-34},{y2} H{34} Q{20},{y2} {20},{y2+14} V{y3-14} '
              f'Q{20},{y3} {34},{y3} H{nx-14}" fill="none" stroke="{col}" stroke-opacity="0.4" '
              f'stroke-width="1.6" stroke-dasharray="6 7"/>')
            a(f'<path d="M{nx-16},{y3-6} L{nx-4},{y3} L{nx-16},{y3+6}" fill="none" stroke="{col}" '
              f'stroke-opacity="0.8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')

    # -- cards --
    for i, (x, y) in enumerate(positions):
        card = cards[i]
        col = accent[i]
        bullets, note, note_y, _ = laid[i]
        a(f'<g transform="translate({x},{y})">')
        shadow = ' filter="url(#lift)"' if p["lift"] == "shadow" else ""
        a(f'<rect x="0" y="0" width="{CW}" height="{CH}" rx="20" fill="{p["cardFill"]}" '
          f'fill-opacity="{p["cardOpacity"]}" stroke="url(#edge{i})" stroke-width="1.5"{shadow}/>')
        a(f'<rect x="0" y="0" width="{CW}" height="{CH}" rx="20" fill="none" '
          f'stroke="{col}" stroke-opacity="{p["cardHalo"]}" stroke-width="6"/>')
        a(f'<circle cx="42" cy="{BADGE_CY}" r="19" fill="{col}" fill-opacity="0.12" '
          f'stroke="{col}" stroke-opacity="0.75" stroke-width="1.4"/>')
        a(f'<text x="42" y="{BADGE_CY+7}" text-anchor="middle" font-size="19" font-weight="600" '
          f'fill="{col}">{card.get("badge", i+1)}</text>')

        tag = card.get("tag")
        if tag:
            label = tag["label"]
            pill = hex_to if tag.get("tone") == "to" else hex_from
            pw = round(len(label) * 8.2) + 42
            px = CW - 26 - pw
            a(f'<rect x="{px}" y="32" width="{pw}" height="28" rx="14" fill="{pill}" fill-opacity="0.10" '
              f'stroke="{pill}" stroke-opacity="0.45" stroke-width="1"/>')
            a(f'<circle cx="{px+16}" cy="{BADGE_CY}" r="4" fill="{pill}" fill-opacity="0.9"/>')
            a(f'<text x="{px+28}" y="{BADGE_CY+5}" font-size="14.5" fill="{p["tagLabel"]}" '
              f'fill-opacity="0.92">{escape(label)}</text>')

        # Title, shrunk to fit rather than clipped.
        t = card["title"]
        size = TITLE_SIZE
        est = len(plain(t)) * size * EM_CAPS
        if est > CW - 2 * PAD:
            size = round(size * (CW - 2 * PAD) / est, 1)
        a(f'<text x="{PAD}" y="{TITLE_Y}" font-size="{size}" font-weight="700" letter-spacing="0.6" '
          f'fill="{p["cardTitle"]}">{rich(t, p)}</text>')
        a(f'<rect x="{PAD}" y="{RULE_Y}" width="150" height="2" fill="url(#rule{i})"/>')

        for by, lines in bullets:
            a(f'<circle cx="{PAD+6}" cy="{by-5}" r="3.4" fill="{col}" fill-opacity="0.9"/>')
            for j, line in enumerate(lines):
                a(f'<text x="{BULLET_X}" y="{by + j*BULLET_LINE_DY}" font-size="{BULLET_SIZE}" '
                  f'font-weight="500" fill="{p["body"]}">{rich(line, p)}</text>')

        for j, line in enumerate(note):
            a(f'<text x="{PAD}" y="{note_y + j*NOTE_LINE_DY}" font-size="{NOTE_SIZE}" font-style="italic" '
              f'fill="{p["note"]}">{rich(line, p)}</text>')

        saved = card.get("saved", [])
        if saved:
            # One band position for the whole grid — dividers, labels and first
            # artifact line share a baseline no matter how many files a step
            # writes. Cards with fewer lines carry the slack at the bottom.
            band = CH - BOTTOM_PAD - SAVED_DY * (max_s - 1) - 44
            dy = band + 50
            a(f'<line x1="{PAD}" y1="{band}" x2="{CW-PAD}" y2="{band}" stroke="{col}" '
              f'stroke-opacity="0.22" stroke-width="1" stroke-dasharray="3 5"/>')
            a(f'<text x="{PAD}" y="{band+24}" font-size="12.5" font-weight="600" letter-spacing="1.8" '
              f'fill="{col}" fill-opacity="1">'
              f'{escape(card.get("savedLabel", default_saved_label))}</text>')
            for j, d in enumerate(saved):
                dim = plain(d).startswith(("—", "or ", "nothing", "failed", "…"))
                a(f'<text x="{PAD}" y="{dy + j*SAVED_DY}" font-family="{MONO}" font-size="14.5" '
                  f'fill="{p["monoDim"] if dim else p["mono"]}">{escape(plain(d))}</text>')
        a('</g>')

    # -- banner --
    if banner:
        by = H - BANNER_H - 30
        bw = min(W - 400, round(len(banner) * 13.6) + 150)
        bx = (W - bw) / 2
        a(f'<g filter="url(#lift)"><rect x="{bx}" y="{by}" width="{bw}" height="{BANNER_H}" '
          f'rx="{BANNER_H/2}" fill="{p["cardFill"]}" stroke="url(#rail)" stroke-width="1.6"/></g>')
        cy = by + BANNER_H / 2
        a(f'<circle cx="{bx+52}" cy="{cy}" r="11" fill="none" stroke="{hex_from}" stroke-width="1.8"/>')
        a(f'<path d="M{bx+46},{cy} l4.5,5 l8-9.5" fill="none" stroke="{hex_from}" stroke-width="2.2" '
          f'stroke-linecap="round" stroke-linejoin="round"/>')
        a(f'<text x="{bx+82}" y="{cy+9}" font-size="26" font-weight="600" fill="{p["cardTitle"]}">'
          f'{escape(banner)}</text>')

    a('</svg>')
    return "\n".join(o), W, H


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    flags = [x for x in sys.argv[1:] if x.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        sys.exit(1)

    mode = "both"
    for f in flags:
        if f.startswith("--mode"):
            mode = f.split("=", 1)[1] if "=" in f else "both"
    if mode not in ("dark", "light", "both"):
        print(f"unknown mode: {mode}")
        sys.exit(1)

    spec = json.load(open(args[0]))
    out = args[1]
    targets = [("dark", out)] if mode == "dark" else \
              [("light", out)] if mode == "light" else \
              [("dark", out), ("light", re.sub(r"\.svg$", "-light.svg", out))]

    for m, path in targets:
        svg, w, h = build(spec, m)
        with open(path, "w") as f:
            f.write(svg)
        print(f"wrote {path}  ({w}x{h}, {len(spec['cards'])} cards, {m})")


if __name__ == "__main__":
    main()
