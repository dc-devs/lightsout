# @lightsout/standards-contracts

The shapes a standards package implements. A rule's `check.ts` imports its types
from here and needs nothing else lightsout knows.

## What is in it

- `StandardsCheckModule` — what a `check.ts` must export.
- `StandardsCheckRun` — the function signature a check provides.
- `RawStandardsFinding` — what a check emits. The engine adds the rule id and the
  severity itself, because a check that could name them could also name them wrong.
- `StandardsCheckInput` and the six input kinds — what a check may ask to be
  given. A check never opens a file; it is handed what it asked for.
- `StandardsPackageRoot` — the shape of `lightsout-standards.json`.
- `StandardsSet` — the two document trees, `code` and `tests`.

## Import types, never values

A shipped standards package has **no runtime dependencies**. That is not an
accident of packaging: lightsout loads a rule's `check.ts` directly under Node's
type stripping, from a plugin install where no `node_modules` exists anywhere
above it. Type imports vanish before Node ever resolves them; a value import
would be a module-not-found at check-load time, on a user's machine.

So write:

```ts
import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
```

and give `inputKind` a plain string literal, which the `StandardsCheckModule`
annotation narrows for you. Biome's `useImportType` rule produces the safe form
and is what stands between this design and a broken install.

Test files are free to import values — they never ship.

## Not published yet

This package ships TypeScript source with no build step, because the engine
already imports a package's `.ts` directly and one answer beats two. Before any
real release to a public registry it needs a compiled output and an `exports` map
pointing at it, or plain-JavaScript consumers cannot use it.
