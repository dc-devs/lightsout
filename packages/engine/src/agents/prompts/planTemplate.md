# Plan Template

Templates for plans consumed by `lightsout implement` and graded by the
deterministic structural lint (`plan grade`, structure) and the gap-check agent
(`plan grade`, decisions). Three variants: **Single Plan** (standalone feature),
**Overview Plan** (multi-phase context), and **Phase Plan** (one implementation
scope under an overview).

## Rules (all variants)

These mirror the structural-lint and gap-check rubrics — a plan violating them
will not reach A:

- **No placeholders.** No `???`, `TBD`, `TODO`, or unresolved `{tokens}`. Every
  open question must be resolved before the plan is written.
- **Every referenced path verified.** Files listed under Files to Modify and
  Patterns to Mirror must exist on disk at write time. Files to Create must not.
- **Backticks around a path assert it exists.** Every backticked span that
  names a file — anywhere in the plan, not only under the file headings — is
  checked against the working tree and blocks if it is not there. A path
  written to illustrate a shape rather than to name a real file goes in plain
  prose, without backticks. Search patterns are exempt: a span holding `*` is
  read as a glob, never as a claim.
- **Earlier-phase files have their own heading.** In a phased plan, a file an
  EARLIER PHASE creates is changed under `## Files to Modify from Earlier
  Phases` — never `## Files to Modify` (whose paths exist on disk today) and
  never `## Files to Create` (whose paths no phase has claimed). Deletes and
  moves have their own headings too; every path under all five is checked and
  counted.
- **Hand-offs chain by name.** Each phase's `## What Next Plan Expects` and the
  next phase's `## Prerequisites` must name the same files and exports, in
  backticked spans — a file path or a bare symbol name. A name one phase hands
  forward and the next never claims is a structural defect.
- **Signatures, not vibes.** Services and modules define their methods and
  signatures — never "create a service for X" without saying what it exposes.
- **Explicit dependency graph.** Module definitions include imports/exports;
  cross-module wiring is stated (exports match imports).
- **Real script names.** Verification commands reference scripts that exist in
  the target `package.json` (or the configured `scripts` overrides).
- **Within the created-file ceiling.** Each plan (or each phase) CREATES at most
  {{createdFileCeiling}} source files. This is a hard ceiling: a phase over it is split, and no
  declaration raises it. A created file has to be specified — its signatures, its
  exports, its behaviour written out — which is what makes creating that many of
  them a full phase.
- **Touched files counted and declared.** Each plan (or each phase) also states
  how many source files it touches in total (created, modified, modified from an
  earlier phase, deleted, and both sides of every move). Above {{fileLimit}} the plan is
  still legal, but it must carry a `## File Budget` covering its real count,
  because {{fileLimit}} is where the implementing agent stops. A phase that creates three
  files and renames an import across two hundred is legitimate work; a phase that
  authors that many from scratch is not.
- **What counts as a source file.** Every path the plan names except test files,
  `index` barrels, and `.d.ts` declaration files. A hand-authored type-only
  module — a `.ts` file exporting one interface — DOES count: it still has to be
  specified and written.
- **Prior art recorded.** Every newly-created exported symbol is justified in a
  `## Prior Art` section: the searches run against existing exports that prove it
  is new, or the existing symbol it mirrors/extends.
- **Global constraints have a home.** Every variant carries a
  `## Global Constraints` section for session-stated project-wide constraints;
  `None` is valid content. Phases inherit the overview's — a phase may write
  "See overview."
{{documentationRule}}

---

## Single Plan

```markdown
# <Feature Name>

## Context

<1–2 paragraphs: what this feature does, why it is needed, and the relevant
current state of the codebase.>

## Decision Log

Every meaningful decision and the road not taken, tagged with the phase that
surfaced it. Log a row only when an answer establishes or changes a decision or
an edge-case handling — skip pure confirmations.

| # | Source | Decision / Question | Options Considered | Choice | Rationale |
|---|--------|---------------------|--------------------|--------|-----------|
| 1 | Elicitation | <decision> | <A / B> | <chosen> | <one line> |

<!-- Source is one of: Brainstorm, Elicitation, Grill, Converge. If a decision was assumed rather than confirmed by the user, append "(assumption)" to the Choice cell. -->

## Global Constraints

Project-wide constraints the user stated for this work — rules every part of
the implementation must respect. Write `None` when none were stated.

- <constraint, or "None">

## Prerequisites

- <required state before implementation begins, or "None">

## Affected Packages

- `<packagesDir>/<name>` — <why this package is touched>

<!-- Single-package repos: state "Single-package repository." packagesDir is the
repo's package directory convention (default `packages`). -->

## Files to Create

### `<packagesDir>/<name>/src/path/to/file.ts`

<Purpose. Key contents: exported functions/classes with full signatures,
methods, imports it needs, what it exports. Enough detail that a fresh-context
agent writes the right code without guessing.>

## Files to Modify

### `<packagesDir>/<name>/src/path/to/existing.ts`

<What changes and where: which function/section, what is added/removed/changed,
and how it integrates with the created files.>

## Files to Modify from Earlier Phases

<Optional — omit the heading entirely when this plan has no such work. Every
path here must be one an EARLIER PHASE creates, and must not exist on disk yet;
a file that is already there belongs under Files to Modify.>

### `<packagesDir>/<name>/src/path/to/from-phase-one.ts`

<Which phase creates it, and what changes here.>

## Files to Delete

<Optional — omit the heading entirely when this plan deletes nothing.>

### `<packagesDir>/<name>/src/path/to/going.ts`

<Why it goes, and what takes over its callers.>

## Files to Move

<Optional — omit the heading entirely when this plan moves nothing. Each
subheading names exactly two paths in backticks, old then new.>

### `<packagesDir>/<name>/src/old/path.ts` → `<packagesDir>/<name>/src/new/path.ts`

<What moves and why.>

## File Budget

<Optional — omit this section unless the plan touches more than {{fileLimit}}
source files. A single integer on its own line: the total source files this plan
touches. It must cover the real count, and it does NOT raise the created-file
ceiling, which is fixed at {{createdFileCeiling}}.>

## Patterns to Mirror

- `<packagesDir>/<name>/src/path/to/analogous.ts` — <what to take from it:
  structure, naming, error handling, etc.>

## Prior Art

One line per newly-created exported symbol, recording the dedup search that
justifies its newness:

- `<symbol>` — searched <terms>, found none (new)
- `<symbol>` — mirrors `<existing export>` (extends, does not duplicate)

## Scope Boundaries

**Do:**
- <in-scope item>

**Do NOT:**
- <explicitly out-of-scope item — adjacent work the agent might be tempted to do>

## Verification

- `<resolved check command>` — types clean
- `<resolved test-unit command>` — tests pass

## What Next Plan Expects

<For a standalone plan: "None — standalone plan." Otherwise: the exact state a
follow-up plan can rely on — files that exist, exports available, behavior
guaranteed.>
```

---

## Overview Plan

The overview carries context shared by all phases. It is **not implemented
directly** — it is passed alongside each phase to `lightsout implement` and to
`plan grade` as context.

```markdown
# <Feature Name> — Overview

## Context

<What this feature does, why, and the relevant current state.>

## Decision Log

Cross-cutting decisions shared by all phases (phase-specific decisions live in
each phase file). Log a row only when an answer establishes or changes a
decision or an edge-case handling — skip pure confirmations.

| # | Source | Decision / Question | Options Considered | Choice | Rationale |
|---|--------|---------------------|--------------------|--------|-----------|
| 1 | Elicitation | <decision> | <A / B> | <chosen> | <one line> |

<!-- Source is one of: Brainstorm, Elicitation, Grill, Converge. -->

## Global Constraints

Project-wide constraints the user stated for this work — rules every part of
the implementation must respect. Write `None` when none were stated.

- <constraint, or "None">

## Architecture

<How the pieces fit together across phases: data flow, module boundaries,
shared types. A diagram or short prose map.>

## Affected Packages

- `<packagesDir>/<name>` — <role in this feature>

## Phases

Creates and Touches are integer counts of source files — the same set the
created-file ceiling and the touched-file budget are measured on (test files,
`index` barrels and `.d.ts` declarations excluded; a hand-authored type-only
module counts). Each must equal the count the phase file itself lists.

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | `phase1-<slug>.md` | <one-line scope> | <n> | <n> |
| 2 | `phase2-<slug>.md` | <one-line scope> | <n> | <n> |

## Phase Declarations

One block per phase, listing ONLY what crosses a phase boundary: the files a
later phase builds against, the exported names later phases import, and the
package scripts this phase adds. The phase file already holds its complete file
list — repeating it here creates two lists that drift the moment either is
edited. Write `none` for a bullet with nothing to declare.

### Phase 1 — `phase1-<slug>.md`

- **Creates:** `<packagesDir>/<name>/src/path/to/file.ts`
- **Exports:** `<symbol>`
- **Scripts:** none

### Phase 2 — `phase2-<slug>.md`

- **Creates:** none
- **Exports:** none
- **Scripts:** none
- **File budget:** <n>

<!-- **File budget:** is optional: include it only when that phase file carries a
`## File Budget`, and repeat the same integer. It must cover that phase's Touches
count, and it never raises the created-file ceiling, which is fixed at
{{createdFileCeiling}}. -->

## Cross-Phase Dependencies

- Phase 2 depends on Phase 1's <export/file/behavior>.
```

---

## Phase Plan

Identical to the Single Plan with these adjustments:

- Title: `# <Feature Name> — Phase <N>: <Phase Name>`
- **Prerequisites** states the prior phase's end state: "Phase <N-1> complete:
  <files/exports that now exist>." Phase 1 states the pre-feature codebase state.
- **Decision Log** may be omitted if fully covered by the overview — reference
  it: "See overview." Phase-specific decisions (including Grill rows raised
  against this phase) still go in this section.
- **Global Constraints** is required in every phase; when the overview's section
  covers it, the content may be "See overview." Phase-specific constraints are
  added as their own bullets.
- **Prior Art** is still mandatory — one line per newly-created exported symbol.
- **Files to Modify from Earlier Phases** is where a file an earlier phase
  creates is changed — never Files to Modify (whose paths must exist on disk
  today) and never Files to Create (whose paths no phase has claimed yet).
- **Files to Delete**, **Files to Move** and **File Budget** carry the same
  meaning as in the Single Plan, per phase.
- **What Next Plan Expects** is mandatory and chains: it must list exactly what
  the next phase's Prerequisites will claim. The final phase states "None —
  final phase."
