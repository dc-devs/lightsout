import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { overviewMarker } from '#tests/helpers/overviewMarker.ts';
import { secondPhaseBody } from '#tests/helpers/secondPhaseBody.ts';

/** The three later phases the five-phase overview declares, each creating its own module so no two phases collide. */
const laterPhases = [
	{ file: 'phase3-more.md', subject: 'third' },
	{ file: 'phase4-yet.md', subject: 'fourth' },
	{ file: 'phase5-last.md', subject: 'fifth' },
];

/** One later phase's body: the clean skeleton, with the module it creates spelled in its own word. */
const laterPhaseBody = ({ subject }: { subject: string }) =>
	cleanPlanBody({ title: 'Graded Plan' })
		.replace(/new-thing/g, `${subject}-thing`)
		.replace(/newThing/g, `${subject}Thing`);

/**
 * The overview a five-phase deliverable needs: a row and a declaration block per
 * phase file. Written out here rather than taken from `cleanOverviewBody`, which
 * declares two — and a phase file the overview never declares is a blocking
 * structural finding, which stops a grading pass before any checker is spawned.
 */
const fivePhaseOverview = () => `# Graded Plan — Overview

## Global Constraints

- None

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | \`phase1-core.md\` | the core | 1 | 1 |
| 2 | \`phase2-extra.md\` | the rest | 1 | 1 |
${laterPhases.map(({ file }, index) => `| ${index + 3} | \`${file}\` | more | 1 | 1 |`).join('\n')}

## Phase Declarations

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

### Phase 2 — \`phase2-extra.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

${laterPhases
	.map(
		({ file }, index) => `### Phase ${index + 3} — \`${file}\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none
`,
	)
	.join('\n')}
## Cross-Phase Dependencies

- ${overviewMarker}
`;

/** A structurally clean five-phase deliverable — the fixture for a fan-out whose fifteen checkers overrun the twelve-slot ceiling. */
export const fivePhasePlanFiles = (): Record<string, string> => ({
	'overview.md': fivePhaseOverview(),
	'phase1-core.md': cleanPlanBody({ title: 'Graded Plan' }),
	'phase2-extra.md': secondPhaseBody(),
	...Object.fromEntries(laterPhases.map(({ file, subject }) => [file, laterPhaseBody({ subject })])),
});
