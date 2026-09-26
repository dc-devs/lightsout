# rendering

The measurements the README GIF's `scripts/renderSprawlSvg.mjs` draws a sprawl
lane from, kept here as typed, tested source rather than inside the script.

The scripts load these files with plain `node`, which strips types and does
nothing else. So a file here may import only its siblings, the feature's own
constants and contracts, and type-only declarations — never a `.tsx` file,
never `#assets/*`, and never `zod` as a value. The same holds for
`../constants/sprawlUnitBox.ts`, which the GIF renderer loads the same way.
Breaking that stops `pnpm build:sprawl-gif` without failing a test.
