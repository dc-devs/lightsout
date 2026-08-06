# Spec contract and style tokens

## Spec fields

```json
{
  "title":      "The plan is where humans decide",
  "subtitle":   "Nine steps of `/plan` — every answer written to disk",
  "columns":    3,
  "savedLabel": "SAVED TO DISK",
  "theme":      { "from": "#35d6e8", "to": "#b06bf5" },
  "themeLight": { "from": "#0e93ad", "to": "#7c3aed" },
  "banner":     "Every decision settled here is a decision no agent guesses.",
  "cards": [
    {
      "title":      "RECORD THE FACTS",
      "badge":      "1",
      "tag":        { "label": "you decide", "tone": "from" },
      "bullets":    ["Verify every referenced file and path"],
      "note":       "Ensures the plan reflects the repository's current state",
      "savedLabel": "SAVED WHEN NOTES EXIST",
      "saved":      [".lightsout/plans/<name>/facts.json", "— stamped verified"]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Backticks render mono. Make it a claim, not a label. |
| `subtitle` | no | Backticks render mono. |
| `columns` | no | Default 3. |
| `savedLabel` | no | Default `SAVED TO DISK`. Try `OUTPUTS`, `WRITES`, `EVIDENCE`. |
| `theme.from` / `theme.to` | no | Dark-mode gradient endpoints; every card colour interpolates between them. |
| `themeLight.from` / `.to` | no | Light-mode endpoints. Omitted → derived from `theme` by clamping lightness to 0.42. |
| `banner` | no | Omitted → the graphic ends at the grid, and the canvas shortens. |
| `cards[].title` | yes | Caps for the reference look. Shrinks to fit rather than clipping. |
| `cards[].badge` | no | Defaults to the card's position. Use for `0`, `4a`, `↻`. |
| `cards[].tag` | no | `tone` is `"from"` (gradient start colour) or `"to"` (end colour). |
| `cards[].bullets` | no | 2–3, each a complete thought. Wraps automatically. |
| `cards[].note` | no | Italic line under the bullets: what this step prevents. Wraps automatically. |
| `cards[].savedLabel` | no | Overrides the graphic-wide label for one card, e.g. `SAVED WHEN NOTES EXIST`. |
| `cards[].saved` | no | Mono, no wrapping. A line starting `—`, `or `, `nothing`, `failed`, or `…` renders dim as an annotation. |

Card height is uniform across the grid, computed from the fullest card. The
artifact band sits at one y for every card — dividers, labels, and first path
line share a baseline regardless of how many files a step writes. Cards with
less content carry the slack as whitespace, which is what keeps the grid
readable as a grid.

Body text is near-white by design. Dark backgrounds tempt you toward muted
greys; they collapse the moment a page scales the image down. Only the
why-line and annotations sit below the body, and only because lower rank is
their job.

## Colour tokens — dark

| Role | Value |
|---|---|
| background wash | `#0d1524` → `#070a12` → `#04060b` (radial, from top) |
| card fill | `#0a0f1a` at 92% |
| card border | per-card gradient, 85% → 35% opacity, plus a 6px 16% halo |
| title text | `#f1f5fb` |
| headline gradient | `#e9f6ff` → `#cdb8ff` |
| body / bullets | `#f0f5fd` |
| why-line (italic) | `#c2d1e6` |
| subtitle | `#c3d3e8` |
| tag label | `#eef4fb` |
| bright mono (paths) | `#f6faff` |
| dim mono (annotations) | `#c6d5e8` |
| inline mono span | `#cdf0fa` |
| gradient start (cyan) | `#35d6e8` |
| gradient end (violet) | `#b06bf5` |
| corner dot texture | `#5b7bb0` at 16% |

## Colour tokens — light

Same roles, re-tuned for white. Not an inversion: accents darken rather than
pale out, and the neon bloom becomes a soft shadow.

| Role | Value |
|---|---|
| background wash | `#ffffff` → `#f7f9fd` → `#eaeff8` (radial, from top) |
| card fill | `#ffffff` at 97%, plus a soft drop shadow |
| card border | per-card gradient, 75% → 28% opacity, plus a 6px 10% halo |
| title text | `#0d1626` |
| headline gradient | `#101a2b` → `#6d28d9` |
| body / bullets | `#26344a` |
| why-line (italic) | `#5d6c85` |
| subtitle | `#4c5a72` |
| tag label | `#33415a` |
| bright mono (paths) | `#152233` |
| dim mono (annotations) | `#67758d` |
| inline mono span | `#0e7490` |
| corner dot texture | `#94a3b8` at 35% |
| accents (derived) | `#35d6e8` → `#1a95a6`, `#b06bf5` → `#7d16f0` |

## Type scale

| Element | Size / weight |
|---|---|
| headline | 62 / 700, letter-spacing −0.5 |
| subtitle | 25 / 400 |
| card title | 26 / 700, letter-spacing 0.6 |
| bullets | 19 / 500 |
| why-line | 16.5 / 400 italic |
| badge number | 19 / 600 |
| tag label | 14.5 / 400 |
| `SAVED TO DISK` label | 12.5 / 600, letter-spacing 1.8 |
| artifact paths | 14.5 mono |
| banner | 26 / 600 |

## Geometry

Card 500 wide, radius 20, padding 28. Column gap 65 (holds the arrow), row gap
82 (holds the wrap connector). Outer margin 90, header band 236, banner 76 tall
with a 9px blur glow. Bullets start at y=164 and step 28 per wrapped line; artifact lines step 24. All of these are constants at the top of `scripts/build_graphic.py`.

## Other palettes in the same style

Swap `theme` for a different mood; everything else holds.

| Mood | from | to |
|---|---|---|
| default (cool tech) | `#35d6e8` | `#b06bf5` |
| heat / urgency | `#ffb545` | `#f0475f` |
| growth / verified | `#3ddc97` | `#35a0e8` |
| single-hue restraint | `#5b8cff` | `#a78bfa` |

Keep the two endpoints far enough apart in hue that the middle cards read as
distinct, and close enough in brightness that no card looks dimmer than its
neighbours. Set only the dark pair and the light pair is derived; set
`themeLight` explicitly when the derivation lands somewhere you dislike.
