import { overviewMarker } from '#tests/helpers/overviewMarker.ts';

/** A structurally clean two-phase overview — the overview variant's own required section set, and nothing declared. */
export const cleanOverviewBody = (): string => `# Graded Plan — Overview

## Global Constraints

- None

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | \`phase1-core.md\` | the core | 1 | 1 |
| 2 | \`phase2-extra.md\` | the rest | 1 | 1 |

## Phase Declarations

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

### Phase 2 — \`phase2-extra.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

## Cross-Phase Dependencies

- ${overviewMarker}
`;
