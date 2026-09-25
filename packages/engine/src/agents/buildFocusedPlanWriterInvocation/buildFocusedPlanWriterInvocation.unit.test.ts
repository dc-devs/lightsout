import { expect, test } from '@jest/globals';
import { buildFocusedPlanWriterInvocation } from '#src/agents/buildFocusedPlanWriterInvocation/buildFocusedPlanWriterInvocation.ts';
import type { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
import type { PlanFacts } from '#src/contracts/plan/facts/PlanFacts.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import type { ExportCollision } from '#src/plan/evidence/common/types/ExportCollision.ts';

type FocusedParams = Parameters<typeof buildFocusedPlanWriterInvocation>[0];

/** A minimal verified PlanFacts with distinctive values to spot in the prompt. */
const planFacts = (): PlanFacts => ({
	request: 'add a foo endpoint',
	areas: [],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-07-09T00:00:00.000Z',
});

/** A one-row decisions record keyed by a distinctive plan name, so the assembled prompt is a realistic one. */
const planDecisions = (): DecisionsRecord => ({
	planName: 'foo-endpoint',
	decisions: [{ source: 'Elicitation', question: 'Which route?', options: 'a / b', choice: 'a', rationale: 'shortest path', assumption: false }],
});

/** One overview declaration row, as `parsePhaseDeclarations` returns it. */
const declarationRow = (): PhaseDeclaration => ({
	number: 2,
	file: 'phase2-wiring.md',
	scope: 'wire it up',
	createdCount: 3,
	touchedCount: 9,
	creates: ['src/wiring.ts'],
	exports: ['wireItUp'],
	scripts: [],
});

/** The engine's rendered evidence for one assignment, with a sentinel no other section could carry. */
const evidenceBrief = (): string =>
	[
		'### `packages/engine/src/plan/sections/renderPhaseRow.ts`',
		'',
		'```ts',
		'export const renderPhaseRow = ({ declaration }: Params): string => { /* … */ };',
		'```',
		'',
		'EVIDENCE-SENTINEL — read at content hash 9f2c1a.',
	].join('\n');

/** Two planned symbols, each answered by two existing exports — the case a single-collision renderer would truncate. */
const censusCollisions = (): ExportCollision[] => [
	{
		symbol: 'renderPhaseRow',
		collidesWith: [
			{ name: 'renderPhaseRow', path: 'packages/engine/src/plan/sections/renderPhaseRow.ts' },
			{ name: 'render_phase_row', path: 'packages/engine/src/legacy/renderPhaseRowLegacy.ts' },
		],
	},
	{
		symbol: 'writePlanSection',
		collidesWith: [
			{ name: 'writePlanSection', path: 'packages/engine/src/plan/sections/writePlanSection.ts' },
			{ name: 'WritePlanSection', path: 'packages/engine/src/legacy/writePlanSectionLegacy.ts' },
		],
	},
];

/** One focused single-plan spawn's inputs, with whatever a case varies laid over them. */
const setupFocusedDraft = (overrides: Partial<FocusedParams> = {}): FocusedParams => ({
	facts: planFacts(),
	decisions: planDecisions(),
	outputs: [{ path: '/repo/.lightsout/work-orders/foo/plans/plan.md', variant: 'single' }],
	limits: { executorFileLimit: 50, createdFileCeiling: 30, touchedFileCeiling: 70 },
	...overrides,
});

/** Every top-level section heading the assembled prompt carries, in assembly order. */
const sectionHeadings = ({ prompt }: { prompt: string }): string[] => prompt.split('\n\n').filter((section) => section.startsWith('## '));

/** The nearest section heading above some text — which section the text was filed under. */
const headingAbove = ({ prompt, text }: { prompt: string; text: string }): string => {
	const preceding = prompt.slice(0, prompt.indexOf(text)).split('\n\n## ').pop() ?? '';

	return `## ${preceding.split('\n')[0]}`;
};

/** Every bullet line that names one planned symbol in a code span. */
const bulletsNaming = ({ prompt, symbol }: { prompt: string; symbol: string }): string[] =>
	prompt.split('\n').filter((line) => line.trimStart().startsWith('- ') && line.includes(`\`${symbol}\``));

test('buildFocusedPlanWriterInvocation: a single-variant spawn given no evidence carries request, outputs, decisions and facts and emits no evidence or prior-art section', () => {
	const params = setupFocusedDraft();

	const invocation = buildFocusedPlanWriterInvocation(params);

	// the draft-input marker leads the prompt
	expect(invocation.prompt.startsWith('# Draft input')).toBeTruthy();
	expect(invocation.prompt.includes('## Feature request\n\nadd a foo endpoint')).toBeTruthy();
	expect(invocation.prompt.includes('- /repo/.lightsout/work-orders/foo/plans/plan.md — variant: single')).toBeTruthy();
	// the decisions record is inlined as JSON
	expect(invocation.prompt.includes('"planName": "foo-endpoint"')).toBeTruthy();
	// the verified facts are inlined as JSON, whole and never trimmed per assignment
	expect(invocation.prompt.includes('"verifiedAt": "2026-07-09T00:00:00.000Z"')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(invocation.prompt.includes('one JSON PlanDraftReport object')).toBeTruthy();
	// a spawn given neither brief gets neither heading — an empty evidence or
	// prior-art heading would read as "the engine found nothing" rather than
	// "the engine was asked for nothing", and every other optional section is
	// absent for the same reason
	expect(sectionHeadings({ prompt: invocation.prompt })).toStrictEqual(['## Feature request', '## Output files', '## Decisions record', '## Verified facts']);
});

test('buildFocusedPlanWriterInvocation: the collected-evidence brief is inlined verbatim between the assignment brief and the decisions record', () => {
	const brief = evidenceBrief();
	const params = setupFocusedDraft({
		outputs: [
			{ path: '/repo/.lightsout/work-orders/foo/plans/overview.md', variant: 'overview' },
			{ path: '/repo/.lightsout/work-orders/foo/plans/phase1-contracts.md', variant: 'phase' },
		],
		evidenceBrief: brief,
	});

	const invocation = buildFocusedPlanWriterInvocation(params);

	// the whole brief lands verbatim — a paraphrase or a truncation would send
	// the writer back to the files this role exists to stop it re-reading
	expect(invocation.prompt.includes(brief)).toBeTruthy();
	// it arrives with the assignment, not after several kilobytes of JSON
	expect(invocation.prompt.indexOf(brief) > invocation.prompt.indexOf('`/repo/.lightsout/work-orders/foo/plans/overview.md`')).toBeTruthy();
	expect(invocation.prompt.indexOf(brief) < invocation.prompt.indexOf('## Decisions record')).toBeTruthy();
	// and under a heading of its own rather than folded into the assignment brief
	expect(headingAbove({ prompt: invocation.prompt, text: brief })).not.toBe('## Overview only');
	expect(headingAbove({ prompt: invocation.prompt, text: brief })).not.toBe('## Output files');
});

test('buildFocusedPlanWriterInvocation: every census collision renders a bullet naming the planned symbol and each colliding export with its path', () => {
	const params = setupFocusedDraft({ collisions: censusCollisions() });

	const invocation = buildFocusedPlanWriterInvocation(params);

	// one bullet per planned symbol, not one per colliding export
	expect(bulletsNaming({ prompt: invocation.prompt, symbol: 'renderPhaseRow' }).length).toBe(1);
	expect(bulletsNaming({ prompt: invocation.prompt, symbol: 'writePlanSection' }).length).toBe(1);
	// both collisions on the first symbol survive, each with the file it is in
	expect(invocation.prompt.includes('packages/engine/src/plan/sections/renderPhaseRow.ts')).toBeTruthy();
	expect(invocation.prompt.includes('render_phase_row')).toBeTruthy();
	expect(invocation.prompt.includes('packages/engine/src/legacy/renderPhaseRowLegacy.ts')).toBeTruthy();
	// and both on the second, so a second symbol is not dropped either
	expect(invocation.prompt.includes('packages/engine/src/plan/sections/writePlanSection.ts')).toBeTruthy();
	expect(invocation.prompt.includes('WritePlanSection')).toBeTruthy();
	expect(invocation.prompt.includes('packages/engine/src/legacy/writePlanSectionLegacy.ts')).toBeTruthy();
});

test('buildFocusedPlanWriterInvocation: an empty census reports that nothing collided, and an absent census emits no prior-art section', () => {
	const ranAndFoundNothing = buildFocusedPlanWriterInvocation(setupFocusedDraft({ collisions: [] }));

	const neverRan = buildFocusedPlanWriterInvocation(setupFocusedDraft());

	// a census that ran and found nothing still gets a heading — the clean result
	// is itself the evidence the plan's `## Prior Art` line has to record
	expect(sectionHeadings({ prompt: ranAndFoundNothing.prompt }).filter((heading) => /prior art/i.test(heading)).length).toBe(1);
	expect(ranAndFoundNothing.prompt).toMatch(/(no|none|nothing)[^.\n]{0,60}collid/i);
	// a spawn that was handed no census gets no heading at all, so the writer can
	// tell "nothing collided" from "nobody looked"
	expect(sectionHeadings({ prompt: neverRan.prompt }).filter((heading) => /prior art/i.test(heading))).toStrictEqual([]);
});

test('buildFocusedPlanWriterInvocation: the system prompt is the focused role prompt plus the focused template with every occurrence of every size token substituted', () => {
	const first = buildFocusedPlanWriterInvocation(setupFocusedDraft({ limits: { executorFileLimit: 80, createdFileCeiling: 12, touchedFileCeiling: 70 } }));

	const second = buildFocusedPlanWriterInvocation(
		setupFocusedDraft({
			facts: { ...planFacts(), request: 'a different request' },
			decisions: { planName: 'other-plan', decisions: [] },
			outputs: [{ path: '/elsewhere/overview.md', variant: 'overview' }],
			limits: { executorFileLimit: 80, createdFileCeiling: 12, touchedFileCeiling: 70 },
			standards: '## Tabs only',
			lintCommand: 'node /elsewhere/cli.mjs plan lint --name other-plan',
		}),
	);

	// the focused role prompt leads the system prompt
	expect(first.systemPrompt.startsWith('# Role: Plan Writer')).toBeTruthy();
	// the template is appended as a labelled section, body and all
	expect(first.systemPrompt.includes('\n\n---\n\n# Plan Template\n\n')).toBeTruthy();
	expect(first.systemPrompt.includes('## Rules (all variants)')).toBeTruthy();
	expect(first.systemPrompt.indexOf('\n\n---\n\n# Plan Template\n\n') < first.systemPrompt.indexOf('## Rules (all variants)')).toBeTruthy();
	// the configured numbers reach the writer, in the carried-over file-budget note
	expect(first.systemPrompt).toMatch(/more than\s+80/);
	expect(first.systemPrompt).toMatch(/fixed at\s+12\./);
	// no token survives anywhere — a second occurrence left standing would reach a
	// written plan, where the lint's unresolved-token scan catches it far later
	expect(first.systemPrompt.includes('{{')).toBeFalsy();
	expect(first.systemPrompt.includes('createdFileCeiling')).toBeFalsy();
	expect(first.systemPrompt.includes('fileLimit')).toBeFalsy();
	expect(first.systemPrompt.includes('documentationRule')).toBeFalsy();
	// and the system prompt does not vary with per-invocation input, so the
	// harness caches the same stable half across every spawn of a draft
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildFocusedPlanWriterInvocation: an overview output drives the focused overview brief and a declaration drives the shared phase-authoring brief, never both', () => {
	const overviewSpawn = buildFocusedPlanWriterInvocation(
		setupFocusedDraft({
			outputs: [
				{ path: '/repo/.lightsout/work-orders/foo/plans/overview.md', variant: 'overview' },
				{ path: '/repo/.lightsout/work-orders/foo/plans/phase1-contracts.md', variant: 'phase' },
			],
		}),
	);

	const phaseSpawn = buildFocusedPlanWriterInvocation(
		setupFocusedDraft({
			outputs: [{ path: '/repo/.lightsout/work-orders/foo/plans/phase2-wiring.md', variant: 'phase' }],
			overviewText: '# Foo — Overview\n\nOVERVIEW-SENTINEL',
			declaration: declarationRow(),
			previousDeclaration: { ...declarationRow(), number: 1, file: 'phase1-contracts.md', creates: ['src/contracts.ts'], exports: ['Contract'] },
		}),
	);

	// the overview spawn is told to author that one path, and gets no phase brief
	expect(overviewSpawn.prompt.includes('## Overview only')).toBeTruthy();
	expect(overviewSpawn.prompt.includes('`/repo/.lightsout/work-orders/foo/plans/overview.md`')).toBeTruthy();
	expect(overviewSpawn.prompt.includes('## Phase authoring')).toBeFalsy();
	// the phase spawn gets the shared phase brief with both declaration rows as
	// the overview's own JSON, and the settled overview inlined verbatim
	expect(phaseSpawn.prompt.includes('## Phase authoring')).toBeTruthy();
	expect(phaseSpawn.prompt.includes('"file": "phase2-wiring.md"')).toBeTruthy();
	expect(phaseSpawn.prompt.includes('"file": "phase1-contracts.md"')).toBeTruthy();
	expect(phaseSpawn.prompt.includes('OVERVIEW-SENTINEL')).toBeTruthy();
	// and never the overview brief, which would send it to write the wrong file
	expect(phaseSpawn.prompt.includes('## Overview only')).toBeFalsy();
});

test('buildFocusedPlanWriterInvocation: a granted sync command is named ahead of the lint command in the self-lint brief', () => {
	const syncCommand = 'node /repo/plugin/dist/cli.mjs plan sync --name foo-endpoint --cwd /repo';
	const lintCommand = 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint --cwd /repo';
	const params = setupFocusedDraft({ lintCommand, syncCommand });

	const invocation = buildFocusedPlanWriterInvocation(params);

	// both commands land verbatim in a code span, so the writer runs the exact
	// string the engine granted rather than one it reconstructs
	expect(invocation.prompt.includes('## Self-lint')).toBeTruthy();
	expect(invocation.prompt.includes(`\`${syncCommand}\``)).toBeTruthy();
	expect(invocation.prompt.includes(`\`${lintCommand}\``)).toBeTruthy();
	// sync first: it composes the sections the writer is forbidden to write, so a
	// lint run ahead of it reports defects the writer is not allowed to fix
	expect(invocation.prompt.indexOf(syncCommand) < invocation.prompt.indexOf(lintCommand)).toBeTruthy();
	// and the brief says which sections that first command owns
	expect(invocation.prompt).toMatch(/engine-owned section/i);
	// the whole step precedes the closing report-contract reminder
	expect(invocation.prompt.indexOf('## Self-lint') < invocation.prompt.indexOf('one JSON PlanDraftReport object')).toBeTruthy();
});

test('buildFocusedPlanWriterInvocation: a lint command granted without a sync command names the lint alone', () => {
	const lintCommand = 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint --cwd /repo';
	const params = setupFocusedDraft({ lintCommand });

	const invocation = buildFocusedPlanWriterInvocation(params);

	// the section is still emitted, carrying the one command this spawn was given
	expect(invocation.prompt.includes('## Self-lint')).toBeTruthy();
	expect(invocation.prompt.includes(`\`${lintCommand}\``)).toBeTruthy();
	// and names no sync step — a spawn granted none must not be told to run one
	expect(invocation.prompt).not.toMatch(/engine-owned section/i);
	expect(invocation.prompt).not.toMatch(/Then run:/);
});

test('buildFocusedPlanWriterInvocation: supplemental standards are inlined verbatim in their own section', () => {
	const standards = '## Tabs only\n\nUse tabs, never spaces.';
	const params = setupFocusedDraft({ standards });

	const invocation = buildFocusedPlanWriterInvocation(params);

	// the standards text lands verbatim under its own heading, after the facts it
	// qualifies rather than ahead of the assignment
	expect(invocation.prompt.includes('## Code standards (supplemental)')).toBeTruthy();
	expect(invocation.prompt.includes('## Tabs only\n\nUse tabs, never spaces.')).toBeTruthy();
	expect(invocation.prompt.indexOf('## Verified facts') < invocation.prompt.indexOf('## Code standards (supplemental)')).toBeTruthy();
});

test('buildFocusedPlanWriterInvocation: a declaration without the settled overview text emits no phase-authoring section', () => {
	const params = setupFocusedDraft({
		outputs: [{ path: '/repo/.lightsout/work-orders/foo/plans/phase2-wiring.md', variant: 'phase' }],
		declaration: declarationRow(),
	});

	const invocation = buildFocusedPlanWriterInvocation(params);

	// the brief inlines the settled overview verbatim, so it is not assembled
	// without one — a half-built brief would send the phase writer off a
	// declaration whose context it never saw
	expect(invocation.prompt.includes('## Phase authoring')).toBeFalsy();
	// and no declaration row leaks into the prompt on its own
	expect(invocation.prompt.includes('"file": "phase2-wiring.md"')).toBeFalsy();
	// the output line still names the file this spawn owns
	expect(invocation.prompt.includes('- /repo/.lightsout/work-orders/foo/plans/phase2-wiring.md — variant: phase')).toBeTruthy();
});

test('buildFocusedPlanWriterInvocation: declared documentation surfaces add the shared documentation brief before the decisions record', () => {
	const params = setupFocusedDraft({
		docs: [
			{ path: 'README.md', covers: 'The product tour.' },
			{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
		],
	});

	const invocation = buildFocusedPlanWriterInvocation(params);

	// every declared surface is named with what it covers
	expect(invocation.prompt.includes('## Documentation surfaces')).toBeTruthy();
	expect(invocation.prompt.includes('- `README.md` — The product tour.')).toBeTruthy();
	expect(invocation.prompt.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
	// the brief arrives with the assignment, ahead of the records
	expect(invocation.prompt.indexOf('## Documentation surfaces') < invocation.prompt.indexOf('## Decisions record')).toBeTruthy();
	// and the matching template rule is substituted in rather than left standing
	expect(invocation.systemPrompt.includes('- **Documentation stated.**')).toBeTruthy();
	expect(invocation.systemPrompt.includes('{{documentationRule}}')).toBeFalsy();
});

/** The template's touched-files rule bullet, from its bold label up to the next rule bullet. */
const touchedFilesRule = ({ systemPrompt }: { systemPrompt: string }): string => {
	const start = systemPrompt.indexOf('- **Touched files counted and declared.**');

	return systemPrompt.slice(start, systemPrompt.indexOf('\n- **', start + 1));
};

/** The phase brief's own bullet lines, stopping before the inlined overview so its text cannot match. */
const phaseAuthoringBullets = ({ prompt }: { prompt: string }): string[] =>
	prompt
		.slice(prompt.indexOf('## Phase authoring'), prompt.indexOf('### The settled overview'))
		.split('\n')
		.filter((line) => line.startsWith('- '));

test('buildFocusedPlanWriterInvocation: the touched-file ceiling is substituted from limits', () => {
	const params = setupFocusedDraft({ limits: { executorFileLimit: 80, createdFileCeiling: 12, touchedFileCeiling: 45 } });

	const invocation = buildFocusedPlanWriterInvocation(params);

	// the configured number reaches the rule that refuses a plan touching more files
	expect(touchedFilesRule({ systemPrompt: invocation.systemPrompt })).toMatch(/\b45\b/);
	// and no token is left standing for a written plan to copy
	expect(invocation.systemPrompt.includes('{{')).toBeFalsy();
	expect(invocation.systemPrompt.includes('touchedFileCeiling')).toBeFalsy();
});

test('buildFocusedPlanWriterInvocation: a phase spawn is told the touched ceiling among its hard limits', () => {
	const params = setupFocusedDraft({
		outputs: [{ path: '/repo/.lightsout/work-orders/foo/plans/phase2-wiring.md', variant: 'phase' }],
		overviewText: '# Foo — Overview\n\nOVERVIEW-SENTINEL',
		declaration: declarationRow(),
		limits: { executorFileLimit: 80, createdFileCeiling: 12, touchedFileCeiling: 45 },
	});

	const invocation = buildFocusedPlanWriterInvocation(params);

	// the one brief bullet stating the number is the hard-limits one, and it names
	// the touched ceiling and the rename-only exemption beside that number
	const ceilingBullets = phaseAuthoringBullets({ prompt: invocation.prompt }).filter((line) => /\b45\b/.test(line));
	expect(ceilingBullets.length).toBe(1);
	expect(ceilingBullets[0]).toMatch(/hard limit/i);
	expect(ceilingBullets[0]).toMatch(/touched-file ceiling/i);
	expect(ceilingBullets[0]).toMatch(/rename-only/i);
});
