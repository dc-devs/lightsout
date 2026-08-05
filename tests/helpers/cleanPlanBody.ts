/**
 * A structurally clean single plan: every required section present, no
 * placeholders, its modify/mirror path (`src/index.js`) real and its create path
 * absent, and a raw `true` verification command that resolves no package script.
 * Its paths line up with `setupConsumerRepo`, so `lintPlanStructure` reports
 * nothing against a repo built by that helper.
 */
export const cleanPlanBody = ({ title = 'Clean Plan' }: { title?: string } = {}) => `# ${title}

## Context

A tiny clean plan for the structural lint.

## Global Constraints

- None

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
