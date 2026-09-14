import type { PhaseDeclaration } from '#src/plan/index.ts';

interface Params {
	path: string;
	overviewText: string;
	declaration: PhaseDeclaration;
	previousDeclaration?: PhaseDeclaration;
}

/** One declaration row as the phase writer receives it: the overview's own JSON, never a paraphrase. */
const declarationBlock = ({ label, declaration }: { label: string; declaration: PhaseDeclaration }) =>
	`### ${label}\n\n\`\`\`json\n${JSON.stringify(declaration, undefined, '\t')}\n\`\`\``;

/**
 * The phase spawn's brief: one file, authored against a settled declaration
 * rather than against its sibling phases, which are being written at the same
 * moment and are not on disk. Both sides of every hand-off are derived from the
 * same declaration rows, so the names match by construction rather than by two
 * agents happening to spell them alike.
 */
export const phaseSection = ({ path, overviewText, declaration, previousDeclaration }: Params): string =>
	`## Phase authoring

Author \`${path}\` and nothing else. The phase breakdown is already settled — do not re-decide it, do not renumber, and do not write any other phase's file. Every other phase is being authored right now by another agent, so no sibling phase file exists for you to read: the declarations below are the whole of what you may rely on. Report only this file in \`filesWritten\`.

${declarationBlock({ label: "This phase's declaration", declaration })}

${
	previousDeclaration === undefined
		? '### The previous phase\n\nThis is phase 1 — there is no previous phase.'
		: declarationBlock({ label: "The previous phase's declaration", declaration: previousDeclaration })
}

### Writing against the declaration

- The declared \`creates\`, \`exports\` and \`scripts\` are a **floor, not a ceiling**. Your file MUST create every declared path, export every declared name and add every declared script — and is free to create whatever else the phase needs. The declaration lists only what crosses a phase boundary, so an internal file no other phase touches is never in it.
- The declared \`createdCount\` and \`touchedCount\` are the overview agent's **estimate** and are not a target. Write what the work requires; the engine stamps the real counts into the overview afterwards. The only hard limits are the created-file ceiling and this phase's own \`## File Budget\`.
- \`## What Next Plan Expects\` states this phase's own declared \`creates\`, \`exports\` and \`scripts\`, each in a backticked span, and nothing else. Write \`None.\` when every bullet of your declaration is \`none\`, and \`None — final phase.\` when your row is the last in the overview's \`## Phases\` table.
- \`## Prerequisites\` states the previous phase's declared \`creates\`, \`exports\` and \`scripts\`, each in a backticked span. Phase 1 states the pre-feature codebase state instead.
- \`## File Budget\` is written when the declaration carries a \`fileBudget\`, repeating that integer. If your phase's real work needs a HIGHER budget than the declaration states, write **the number you need** — never the declared one — and omit the section entirely if you need none. The mismatch is reported and resolved against the overview later; understating your budget to avoid a finding is the one thing that would actually break the run.

### The settled overview

${overviewText}`;
