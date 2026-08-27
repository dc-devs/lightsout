# rendering

The measurements both renderers of a sprawl lane share: the page's
`SprawlChart` and the README GIF's `scripts/renderSprawlSvg.mjs` compute one
geometry rather than two, so the image cannot drift from the page.

The scripts load these files with plain `node`, which strips types and does
nothing else. So a file here may import only its siblings, the feature's own
constants and contracts, and type-only declarations — never a `.tsx` file,
never `#assets/*`, and never `zod` as a value. The same holds for
`../constants/sprawlUnitBox.ts`, which the GIF renderer loads the same way.
Breaking that stops `pnpm build:sprawl-gif` without failing a test.
