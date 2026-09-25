import { renderDecisionLog } from '#src/plan/decisionLog/renderDecisionLog.ts';
import { renderGlobalConstraints } from '#src/plan/sections/renderGlobalConstraints.ts';
import { overviewMarker } from '#tests/helpers/overviewMarker.ts';

/** A structurally clean two-phase overview — the overview variant's own required section set, and nothing declared. An overview carries the full rendered table, never the phase pointer. */
export const cleanOverviewBody = (): string => `# Graded Plan — Overview

${renderDecisionLog({ decisions: [] })}

${renderGlobalConstraints({ decisions: [] })}

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
