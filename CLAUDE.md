# lightsout

Deterministic engine for coding agents: a code spine (gates, typed contracts,
resumable manifests, supervisor) that spawns the user's own installed harness
(Claude Code, Codex) to do the work. It makes agents accountable, not smarter.

## Start here

- `docs/architecture.md` — full design, non-negotiable rules, decision log,
  roadmap. Read it before proposing architectural changes; the decision log
  records what was already settled and why.
- State: v0.1–v0.6 shipped (pipeline, resume/parking, supervisor,
  friction→self-improvement loop, standards injection, claude-code + codex
  drivers; v0.5: git-truth changed files, zero-change implement gate,
  parallel per-file test writers, refactor loop, coverage/build/format gates,
  `--overview` phased plans; v0.6: monorepo scoped gates via `packageScripts`
  + plan front-matter scope). FeedbackDrop is consumer #1 via its own
  `lightsout.config.json`.

## Commands

- `pnpm check` — typecheck (root tsc, all packages)
- `pnpm test` — engine suite (`packages/engine/tests/`, node:test via esbuild
  bundle, stub drivers only). Run it before any commit that touches engine
  behavior.
- `pnpm bundle` — build `dist/cli.mjs`. The bundle is COMMITTED by design
  (plugin installs are git clones with no install hook): rebuild and commit it
  with any source change.
- Smoke-test pattern: write a scratch `.ts`, bundle with
  `pnpm exec esbuild <file> --bundle --platform=node --format=esm --loader:.md=text`,
  run with node. Stub drivers for exception paths; live drivers for happy
  paths. `fixtures/toy-calc/` is the live-e2e consumer fixture.

## Hard rules (settled — do not relitigate; see decision log)

- No npm distribution. This repo is both the Claude Code plugin and the engine.
- Drivers shell the user's own logged-in harness binary; the engine NEVER
  handles model credentials. (The Agent SDK is API-key-billed and was
  explicitly rejected — headless `claude -p` rides the Max subscription.)
- The plugin skill is the ignition, not the engine: zero logic in markdown, ever.
- Rate-limit exhaustion is a pausable run state, not an error.
- Born generic: the engine never references any consumer by name; consumers
  integrate via `lightsout.config.json` only.
- Verify CLI flags against the installed binary before writing code that
  invokes it (claude 2.1.198 and codex-cli 0.128.0 at last verification).
- Every feature lands with verification: typecheck + a stub-driver smoke test
  + a live smoke test where feasible. Report outcomes honestly, including
  what was NOT live-tested.

## Conventions

- One exported item per file; file named exactly after its export.
- Object params, destructured; exported functions declare a `Params` interface.
- No explicit return type annotations — let TypeScript infer.
- No enums: PascalCase `as const` object + derived union of the same name.
- Parse, don't cast: zod at every boundary (agent reports, manifests, config).
- Tabs. Arrow functions. Barrels are deliberate public APIs.
- Agent prompts are markdown in `packages/agents/prompts/`, paired with zod
  contracts in code; prompts are imported as text at bundle time.
