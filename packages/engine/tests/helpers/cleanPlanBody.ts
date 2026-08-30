/**
 * A structurally clean single plan: every required section present, no
 * placeholders, its modify/mirror path (`src/index.js`) real and its create path
 * absent, and a raw `true` verification command that resolves no package script.
 * Its paths line up with `setupConsumerRepo`, so `lintPlanStructure` reports
 * nothing against a repo built by that helper.
 *
 * The `## Documentation` section is opt-in because the required-section set is:
 * only a repository declaring a `docs` block needs one, so omitting the
 * parameter leaves the body byte-identical to what an undeclared repo's tests
 * have always linted.
 */
export const cleanPlanBody = ({ title = 'Clean Plan', documentation }: { title?: string; documentation?: string } = {}) => `# ${title}

## Context

A tiny clean plan for the structural lint.

## Global Constraints

- None
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
