import { expect, test } from '@jest/globals';
import { buildPlanWriterInvocation } from '#src/agents/index.ts';
import type { DecisionsRecord, PlanFacts } from '#src/contracts/index.ts';
import type { PhaseDeclaration } from '#src/plan/index.ts';

/** A minimal verified PlanFacts with distinctive values to spot in the prompt. */
const facts = (): PlanFacts => ({
	request: 'add a foo endpoint',
	areas: [],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-07-09T00:00:00.000Z',
});

/** A one-row decisions record keyed by a distinctive plan name. */
const decisions = (): DecisionsRecord => ({
	planName: 'foo-endpoint',
	decisions: [{ source: 'Elicitation', question: 'Which route?', options: 'a / b', choice: 'a', rationale: 'shortest path', assumption: false }],
});

const singleOutput = () => [{ path: '/repo/.lightsout/plans/foo/plan.md', variant: 'single' as const }];

/** The two engine-owned size numbers every spawn is assembled with. */
const limits = () => ({ executorFileLimit: 50, createdFileCeiling: 30 });

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

test('buildPlanWriterInvocation: single-variant prompt carries the request, output line, decisions, and facts — no phased or standards sections', () => {
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), limits: limits() });

	// the writer invocation marker leads the prompt
	expect(invocation.prompt.startsWith('# Draft input')).toBeTruthy();
	expect(invocation.prompt.includes('## Feature request\n\nadd a foo endpoint')).toBeTruthy();
	expect(invocation.prompt.includes('- /repo/.lightsout/plans/foo/plan.md — variant: single')).toBeTruthy();
	// the decisions record is inlined as JSON
	expect(invocation.prompt.includes('"planName": "foo-endpoint"')).toBeTruthy();
	// the verified facts are inlined as JSON
	expect(invocation.prompt.includes('"verifiedAt": "2026-07-09T00:00:00.000Z"')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(invocation.prompt.includes('one JSON PlanDraftReport object')).toBeTruthy();
	// no phased section without an overview output
	expect(invocation.prompt.includes('## Overview only')).toBeFalsy();
	// no standards section when standards are absent
	expect(invocation.prompt.includes('## Code standards')).toBeFalsy();
	// no self-lint section without a lint command
	expect(invocation.prompt.includes('## Self-lint')).toBeFalsy();
});

test('buildPlanWriterInvocation: author-only — no corrective findings surface anywhere in the invocation', () => {
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), limits: limits() });

	// the prompt carries no corrective findings section
	expect(invocation.prompt.includes('Structural findings')).toBeFalsy();
	// the role prompt carries no corrective findings surface
	expect(invocation.systemPrompt.includes('Structural findings')).toBeFalsy();
});

test('buildPlanWriterInvocation: system prompt is the stable role prompt with the plan template appended, identical across invocations', () => {
	const first = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), limits: limits() });
	const second = buildPlanWriterInvocation({
		facts: { ...facts(), request: 'a different request' },
		decisions: { planName: 'other-plan', decisions: [] },
		outputs: [{ path: '/elsewhere/overview.md', variant: 'overview' }],
		limits: limits(),
		standards: '## Tabs only',
		lintCommand: 'node /elsewhere/cli.mjs plan lint --name other-plan',
	});

	// the role prompt leads the system prompt
	expect(first.systemPrompt.startsWith('# Role: Plan Writer')).toBeTruthy();
	// the template is appended as a labelled section
	expect(first.systemPrompt.includes('\n\n---\n\n# Plan Template\n\n')).toBeTruthy();
	// the appended section carries the template body, not just its label
	expect(first.systemPrompt.includes('## Rules (all variants)')).toBeTruthy();
	// the template body lands after the label, inside the appended section
	expect(first.systemPrompt.indexOf('\n\n---\n\n# Plan Template\n\n') < first.systemPrompt.indexOf('## Rules (all variants)')).toBeTruthy();
	// the system prompt does not vary with per-invocation input
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanWriterInvocation: the system prompt documents the Brainstorm origin as engine-merged rows', () => {
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), limits: limits() });

	// the role prompt names the origin the merged rows arrive under
	expect(invocation.systemPrompt).toMatch(/`Brainstorm` rows/);
	// and states the engine merges them in — the writer never fetches them itself
	expect(invocation.systemPrompt).toMatch(/the engine merges them in/);
});

test('buildPlanWriterInvocation: an overview output adds the overview-only section naming that one path', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [
			{ path: '/repo/.lightsout/plans/foo/overview.md', variant: 'overview' },
			{ path: '/repo/.lightsout/plans/foo/phase1-contracts.md', variant: 'phase' },
		],
		limits: limits(),
	});

	expect(invocation.prompt.includes('- /repo/.lightsout/plans/foo/overview.md — variant: overview')).toBeTruthy();
	// every output file gets its own bullet
	expect(invocation.prompt.includes('- /repo/.lightsout/plans/foo/phase1-contracts.md — variant: phase')).toBeTruthy();
	expect(invocation.prompt.includes('## Overview only')).toBeTruthy();
	// the section names the overview path
	expect(invocation.prompt.includes('`/repo/.lightsout/plans/foo/overview.md`')).toBeTruthy();
	// and says in as many words that this spawn writes no phase file — the whole
	// point of the two-stage draft is that separate agents author those
	expect(invocation.prompt.includes('and nothing else — not one phase file')).toBeTruthy();
	// no phase-authoring section without a declaration
	expect(invocation.prompt.includes('## Phase authoring')).toBeFalsy();
});

test('buildPlanWriterInvocation: a declaration adds the phase-authoring section with both declaration rows and the settled overview', () => {
	const previous = { ...declarationRow(), number: 1, file: 'phase1-contracts.md', creates: ['src/contracts.ts'], exports: ['Contract'] };
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [{ path: '/repo/.lightsout/plans/foo/phase2-wiring.md', variant: 'phase' }],
		overviewText: '# Foo — Overview\n\nOVERVIEW-SENTINEL',
		declaration: declarationRow(),
		previousDeclaration: previous,
		limits: limits(),
	});

	expect(invocation.prompt.includes('## Phase authoring')).toBeTruthy();
	// the file this spawn owns is named, and only that one
	expect(invocation.prompt.includes('`/repo/.lightsout/plans/foo/phase2-wiring.md`')).toBeTruthy();
	// its own row rides as the overview's JSON, never a paraphrase
	expect(invocation.prompt.includes('"file": "phase2-wiring.md"')).toBeTruthy();
	// the previous row rides too — it is what this phase's Prerequisites state,
	// and deriving both sides from one row is what makes the hand-off match
	expect(invocation.prompt.includes('"file": "phase1-contracts.md"')).toBeTruthy();
	// the settled overview is inlined verbatim
	expect(invocation.prompt.includes('OVERVIEW-SENTINEL')).toBeTruthy();
	// the declaration is a floor, not a target to build down to
	expect(invocation.prompt.includes('**floor, not a ceiling**')).toBeTruthy();
	// an overview-only brief would tell this spawn to write the wrong file
	expect(invocation.prompt.includes('## Overview only')).toBeFalsy();
});

test('buildPlanWriterInvocation: phase 1 is told there is no previous phase rather than handed an empty row', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [{ path: '/repo/.lightsout/plans/foo/phase1-contracts.md', variant: 'phase' }],
		overviewText: '# Foo — Overview',
		declaration: { ...declarationRow(), number: 1, file: 'phase1-contracts.md' },
		limits: limits(),
	});

	expect(invocation.prompt.includes('This is phase 1 — there is no previous phase.')).toBeTruthy();
	expect(invocation.prompt.includes("The previous phase's declaration")).toBeFalsy();
});

test('buildPlanWriterInvocation: the size numbers are substituted into the template rather than hard-coded in it', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: singleOutput(),
		limits: { executorFileLimit: 80, createdFileCeiling: 12 },
	});

	// the configured numbers reach the writer verbatim
	expect(invocation.systemPrompt.includes('CREATES at most\n  12 source files')).toBeTruthy();
	expect(invocation.systemPrompt.includes('Above 80 the plan is')).toBeTruthy();
	// and no token survives into what the agent reads — a plan can never inherit one
	expect(invocation.systemPrompt.includes('{{')).toBeFalsy();
});

test('buildPlanWriterInvocation: a lint command adds the self-lint section verbatim, before the report-contract reminder', () => {
	const lintCommand = 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint --cwd /repo';

	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), limits: limits(), lintCommand });

	expect(invocation.prompt.includes('## Self-lint')).toBeTruthy();
	// the exact command lands verbatim in a code span
	expect(invocation.prompt.includes(`\`${lintCommand}\``)).toBeTruthy();
	// the self-lint step precedes the closing report-contract reminder
	expect(invocation.prompt.indexOf('## Self-lint') < invocation.prompt.indexOf('one JSON PlanDraftReport object')).toBeTruthy();
});

test('buildPlanWriterInvocation: with every optional input present, all sections land in assembly order', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [
			{ path: '/repo/.lightsout/plans/foo/overview.md', variant: 'overview' },
			{ path: '/repo/.lightsout/plans/foo/phase1-contracts.md', variant: 'phase' },
		],
		limits: limits(),
		standards: '## Tabs only',
		lintCommand: 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint',
	});

	const order = [
		'# Draft input',
		'## Feature request',
		'## Output files',
		'## Overview only',
		'## Decisions record',
		'## Verified facts',
		'## Code standards (supplemental)',
		'## Self-lint',
		'one JSON PlanDraftReport object',
	].map((heading) => invocation.prompt.indexOf(heading));

	// every section is present and lands in assembly order, got indices
	// ${order.join(', ')}
	expect(order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1]))).toBeTruthy();
});

test('buildPlanWriterInvocation: an overview listed after a phase output still drives the overview-only section', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [
			{ path: '/repo/.lightsout/plans/bar/phase1-contracts.md', variant: 'phase' },
			{ path: '/repo/.lightsout/plans/bar/overview.md', variant: 'overview' },
		],
		limits: limits(),
	});

	// the overview is found regardless of its position in outputs
	expect(invocation.prompt.includes('## Overview only')).toBeTruthy();
	// the section names the overview path, not the first output
	expect(invocation.prompt.includes('`/repo/.lightsout/plans/bar/overview.md`')).toBeTruthy();
});

test('buildPlanWriterInvocation: supplemental standards are inlined verbatim in their own section', () => {
	const standards = '## Tabs only\n\nUse tabs, never spaces.';

	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), limits: limits(), standards });

	expect(invocation.prompt.includes('## Code standards (supplemental)')).toBeTruthy();
	// the standards text lands verbatim
	expect(invocation.prompt.includes('## Tabs only\n\nUse tabs, never spaces.')).toBeTruthy();
});

test('buildPlanWriterInvocation: every occurrence of each size token is substituted, not just the first', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: singleOutput(),
		limits: { executorFileLimit: 80, createdFileCeiling: 12 },
	});

	// the file-budget guidance states the same limit as the all-variants rule
	expect(invocation.systemPrompt.includes('unless the plan touches more than 80\nsource files')).toBeTruthy();
	// the ceiling is restated for the plan's own budget section
	expect(invocation.systemPrompt.includes('ceiling, which is fixed at 12.>')).toBeTruthy();
	// and again in the phase-file budget note, which a later occurrence would have missed
	expect(invocation.systemPrompt.includes('never raises the created-file ceiling, which is fixed at\n12.')).toBeTruthy();
});

test('buildPlanWriterInvocation: a declaration without the settled overview text emits no phase-authoring section', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [{ path: '/repo/.lightsout/plans/foo/phase2-wiring.md', variant: 'phase' }],
		declaration: declarationRow(),
		limits: limits(),
	});

	// the phase brief inlines the overview verbatim, so it is not assembled without one
	expect(invocation.prompt.includes('## Phase authoring')).toBeFalsy();
	// and no declaration row leaks into the prompt on its own
	expect(invocation.prompt.includes('"file": "phase2-wiring.md"')).toBeFalsy();
	// the output line still names the file this spawn owns
	expect(invocation.prompt.includes('- /repo/.lightsout/plans/foo/phase2-wiring.md — variant: phase')).toBeTruthy();
});

test('buildPlanWriterInvocation: declared documentation surfaces add the template rule and the prompt brief', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: singleOutput(),
		limits: limits(),
		docs: [
			{ path: 'README.md', covers: 'The product tour.' },
			{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
		],
	});

	// the template's all-variants rule now asks for the section
	expect(invocation.systemPrompt.includes('- **Documentation stated.**')).toBeTruthy();
	expect(invocation.systemPrompt.includes('immediately\n  after `## Global Constraints`')).toBeTruthy();
	// and the prompt names the surfaces, each with what it covers
	expect(invocation.prompt.includes('## Documentation surfaces')).toBeTruthy();
	expect(invocation.prompt.includes('- `README.md` — The product tour.')).toBeTruthy();
	expect(invocation.prompt.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
});

test('buildPlanWriterInvocation: a repository declaring no surfaces sees no documentation text and no standing token', () => {
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), limits: limits() });

	// no rule in the template, no section in the prompt — an undeclared repository
	// pays nothing for a key it never wrote
	expect(invocation.systemPrompt.includes('Documentation')).toBeFalsy();
	expect(invocation.prompt.includes('Documentation')).toBeFalsy();
	// and the token is substituted away rather than left standing, which the plan
	// lint's unresolved-token scan would otherwise catch in a written plan
	expect(invocation.systemPrompt.includes('{{documentationRule}}')).toBeFalsy();
	// the prompt's section list is exactly what it was before the key existed
	expect(invocation.prompt.split('\n\n').filter((section) => section.startsWith('## '))).toStrictEqual([
		'## Feature request',
		'## Output files',
		'## Decisions record',
		'## Verified facts',
	]);
});
