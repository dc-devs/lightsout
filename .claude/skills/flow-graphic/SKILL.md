---
name: flow-graphic
description: Build a dark, neon-gradient card stepper infographic (SVG + PNG) for a README, docs page, or launch post — numbered cards in a grid, each with bullets and the files that step writes. Use when the user asks for an infographic, a workflow or process diagram, a "flow chart image", or wants to visualize a pipeline's steps in the style of a developer-brand landing page.
---

# flow-graphic

## What this style is called

There is no single official name for it. It is a **card stepper** — a process
flow whose steps are numbered cards rather than boxes-and-lines — drawn in the
**dark developer-brand look**: near-black background, one neon gradient walking
across the sequence, hairline glowing borders, generous padding, and monospace
type for anything a machine reads or writes. If you need to ask a designer for
it, say "a numbered card stepper, dark UI, cyan-to-violet gradient." It is the
house style of dev-tool landing pages (Linear, Vercel, Stripe's dark mode).

## What makes it work

Six rules. Break them and it turns into a slide from 2013.

1. **One gradient carries the whole sequence.** Card 1 is cyan, the last card
   is violet, every card in between is interpolated — badge, title rule,
   bullets, and border all shift together. Progress reads at thumbnail size,
   before a single word is legible.
2. **The background is near-black, not black.** A radial wash (`#0d1524` at the
   top fading to `#04060b`) gives depth. Flat `#000` looks cheap.
   **Do not let dark mode talk you into grey body text.** Bullets sit at
   `#d3dfef` / 500 weight — a "muted" `#aab7cd` looks right in the source and
   turns to mush once GitHub scales the image down. Reserve the dimmer greys
   for the why-line and annotations, where lower rank is the point.
3. **Cards are uniform.** Same width, same height, same internal baselines —
   the "saved to disk" band is bottom-anchored so the dividers line up straight
   across the grid. Ragged cards are what make an infographic look homemade.
4. **One idea per bullet, and the bullet is a complete thought.** Never let a
   sentence run across two bullets — each dot must stand alone.
5. **Monospace is reserved for machine truth** — file paths, commands, flags.
   That contrast is what makes the graphic read as technical rather than
   decorative.
6. **One closing line.** A single pill at the bottom with the claim the whole
   graphic exists to support. Not three. One.
7. **Every card says what it prevents.** One italic line under the bullets,
   naming what would go wrong without this step ("Prevents duplicate logic and
   competing abstractions"). Bullets describe the mechanism; this line is the
   argument. It is what separates a diagram from a feature list.

## How to build one

**Get the content from the real thing, never from memory.** If it is a pipeline,
read the code that runs it. If it is a workflow, read the skill or doc that
defines it. A graphic that flatters the design but misstates a step is worse
than no graphic — it will outlive the mistake on a README.

Then:

1. **Write a spec** — a JSON file, one entry per card. Shape and options are in
   `reference/spec.md`; a full working example is `examples/plan-workflow.json`.
2. **Build the SVG — both themes, one command:**
   ```sh
   python3 "$SKILL_DIR/scripts/build_graphic.py" spec.json out.svg
   # writes out.svg (dark) and out-light.svg
   ```
   Add `--mode=dark` or `--mode=light` for one only. Default is both, because a
   theme built later always drifts from the one built first.
3. **Render a PNG at 2× the SVG's own width** — the builder prints the SVG
   dimensions, so a 2375-wide graphic renders at 4750:
   ```sh
   rsvg-convert -w 4750 out.svg -o out.png      # brew install librsvg
   ```
   Rendering at 1× is what makes a graphic look faintly pixelated on a retina
   display or once a page scales it. Expect roughly 1–1.5 MB at 2×; that is the
   right trade for a hero image, and the SVG stays the primary reference.
   No `rsvg-convert`? Use Chrome:
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless
   --screenshot=out.png --window-size=2375,1610 --force-device-scale-factor=2
   --default-background-color=0 out.svg`
4. **Read both PNGs with the Read tool and actually look at them.** This is not
   optional — it is the only way to catch overflowing text, a broken sentence,
   or a connector landing in the wrong place. Light mode fails differently from
   dark, so check it too. Fix the spec, rebuild, look again.
5. **Ship the set together** — `name.json`, `name.svg`, `name.png`,
   `name-light.svg`, `name-light.png` in one folder. The spec is the editable
   source; the SVGs are what a README references; the PNGs are the fallback for
   anywhere SVG is unwelcome.

In a GitHub README, serve the pair by theme:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/name.svg">
  <img alt="…" src="assets/name-light.svg">
</picture>
```

## Content limits that keep it clean

| Field | Limit | Why |
|---|---|---|
| card title | ~32 chars | shrinks to fit past ~26; below 20pt it looks apologetic |
| bullets per card | 2–3 | four makes the card a wall |
| bullet text | ~90 chars | wraps at ~46; two lines is fine, three is a paragraph |
| `note` | ~110 chars | one thought, wraps to two lines |
| `saved` lines | 1–3 | mono is wide; ~50 chars each, no wrapping |
| tag label | ~12 chars | the pill auto-sizes but crowds the badge |
| total cards | 6–12 | past 12, split into two graphics |

Bullets and notes wrap on their own; titles shrink to fit. Artifact lines do
neither — break those by hand across `saved` entries.

Columns: **3** for 6 or 9 cards, **4** for 8 or 12, **5** for a single-row strip.
Prefer the layout that fills its last row — eight cards as 4×2 beats 3+3+2. Rows
wrap with a dashed connector; a one-row layout gets plain arrows.

## Light mode is a re-tune, not an inversion

Three things change, and only these three:

- **Accents get darker, not paler.** A neon that sings on near-black is
  invisible on white. Each endpoint keeps its hue and saturation but has its
  lightness clamped to 0.42 (`for_light()` in the builder), so cyan→violet stays
  recognisably the same ramp with the contrast restored. Override per graphic
  with `themeLight` when the derived pair is not what you want.
- **The neon bloom becomes a soft drop shadow.** A glow on white reads as a
  smudge. Cards get the shadow too — on dark they need none, because the border
  gradient already separates them from the background.
- **Body text flips to near-black** (`#26344a`), with the same rank order:
  bullets darkest, why-line and annotations lighter.

Everything else — geometry, gradient direction, card structure, the artifact
band — is identical between the two, which is what keeps them recognisable as
one graphic.

## Judgment calls worth making deliberately

- **Tag pills are the highest-value addition.** A one-word pill per card ("you
  decide" / "the engine", "manual" / "automatic") turns a list of steps into an
  argument about who is accountable for what. Add one whenever the sequence has
  two kinds of actor.
- **Keep artifacts inside the cards** when the step→file link is the point. Move
  them to a band under the grid only when the files are incidental.
- **The title should make a claim**, not name a noun. "The plan is where humans
  decide" beats "Plan workflow." The subtitle carries the literal description.
- **Repeated steps** (a verify gate that runs three times) can either repeat as
  cards or collapse into one card the writers feed into. Collapsing is usually
  truer to the mechanism — say which you chose and why.

## Pitfalls

- **librsvg ignores most CSS.** Style with SVG attributes only. `feGaussianBlur`
  and gradients work; filters beyond a simple glow may not.
- **Fonts must exist locally.** The stack is Helvetica Neue / Menlo, safe on
  macOS. Naming a font that is not installed silently substitutes and wrecks the
  measured layout.
- **Text width is estimated, not measured.** The pill and banner sizes come from
  character counts. Long labels need a look at the render.
- **Backticks in the title/subtitle** switch to the mono face — use them for
  command names, nothing else.
