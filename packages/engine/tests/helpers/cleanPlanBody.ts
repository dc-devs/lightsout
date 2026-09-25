import { decisionLogReference } from '#src/plan/decisionLog/decisionLogReference.ts';
import { renderDecisionLog } from '#src/plan/decisionLog/renderDecisionLog.ts';
import { renderGlobalConstraints } from '#src/plan/sections/renderGlobalConstraints.ts';

/**
 * A structurally clean single plan: every required section present, no
 * placeholders, its modify/mirror path (`src/index.js`) real and its create path
 * absent, and a raw `true` verification command that resolves no package script.
 * Its paths line up with `setupConsumerRepo`, so `lintPlanStructure` reports
 * nothing against a repo built by that helper.
 *
 * The `## Decision Log` and the `## Global Constraints` are both rendered by the
 * engine's own renderers from an empty record, so the fixture can never drift
 * from the sections the two currency checks re-render. Unlike `documentation`
 * neither is opt-in: both checks run on every plan file. `reference` swaps the
 * table for the pointer sentence, which is what a phase file of a phased
 * deliverable carries instead.
 *
 * The `## Documentation` section is opt-in because the required-section set is:
 * only a repository declaring a `docs` block needs one, so omitting the
 * parameter leaves the body byte-identical to what an undeclared repo's tests
 * have always linted.
 */
export const cleanPlanBody = ({
	title = 'Clean Plan',
	documentation,
	reference = false,
}: {
	title?: string;
	documentation?: string;
	reference?: boolean;
} = {}) => `# ${title}

## Context

A tiny clean plan for the structural lint.

${reference ? decisionLogReference() : renderDecisionLog({ decisions: [] })}

${renderGlobalConstraints({ decisions: [] })}
${documentation === undefined ? '' : `\n## Documentation\n\n${documentation}\n`}
## Prerequisites

- None

## Files to Create

### \`src/new-thing.ts\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing/new-thing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None — standalone plan.
`;
