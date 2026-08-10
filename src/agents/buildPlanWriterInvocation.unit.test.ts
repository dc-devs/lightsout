import { expect, test } from '@jest/globals';
import { buildPlanWriterInvocation } from '@/agents';
import type { DecisionsRecord, PlanFacts } from '@/contracts';

/** A minimal verified PlanFacts with distinctive values to spot in the prompt. */
const facts = (): PlanFacts => ({
	request: 'add a foo endpoint',
	areas: [],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
	verifiedAt: '2026-07-09T00:00:00.000Z',
});

/** A one-row decisions record keyed by a distinctive plan name. */
const decisions = (): DecisionsRecord => ({
	planName: 'foo-endpoint',
	decisions: [{ source: 'Elicitation', question: 'Which route?', options: 'a / b', choice: 'a', rationale: 'shortest path', assumption: false }],
});

const singleOutput = () => [{ path: '/repo/.lightsout/plans/foo/plan.md', variant: 'single' as const }];

test('buildPlanWriterInvocation: single-variant prompt carries the request, output line, decisions, and facts — no phased or standards sections', () => {
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput() });

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
	expect(invocation.prompt.includes('## Phased authoring')).toBeFalsy();
	// no standards section when standards are absent
	expect(invocation.prompt.includes('## Code standards')).toBeFalsy();
	// no self-lint section without a lint command
	expect(invocation.prompt.includes('## Self-lint')).toBeFalsy();
});

test('buildPlanWriterInvocation: author-only — no corrective findings surface anywhere in the invocation', () => {
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput() });

	// the prompt carries no corrective findings section
	expect(invocation.prompt.includes('Structural findings')).toBeFalsy();
	// the role prompt carries no corrective findings surface
	expect(invocation.systemPrompt.includes('Structural findings')).toBeFalsy();
});

test('buildPlanWriterInvocation: system prompt is the stable role prompt with the plan template appended, identical across invocations', () => {
	const first = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput() });
	const second = buildPlanWriterInvocation({
		facts: { ...facts(), request: 'a different request' },
		decisions: { planName: 'other-plan', decisions: [] },
		outputs: [{ path: '/elsewhere/overview.md', variant: 'overview' }],
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
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput() });

	// the role prompt names the origin the merged rows arrive under
	expect(invocation.systemPrompt).toMatch(/`Brainstorm` rows/);
	// and states the engine merges them in — the writer never fetches them itself
	expect(invocation.systemPrompt).toMatch(/the engine merges them in/);
});

test('buildPlanWriterInvocation: an overview output adds the phased-authoring section naming the overview path and its directory', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [
			{ path: '/repo/.lightsout/plans/foo/overview.md', variant: 'overview' },
			{ path: '/repo/.lightsout/plans/foo/phase1-contracts.md', variant: 'phase' },
		],
	});

	expect(invocation.prompt.includes('- /repo/.lightsout/plans/foo/overview.md — variant: overview')).toBeTruthy();
	// every output file gets its own bullet
	expect(invocation.prompt.includes('- /repo/.lightsout/plans/foo/phase1-contracts.md — variant: phase')).toBeTruthy();
	expect(invocation.prompt.includes('## Phased authoring')).toBeTruthy();
	// the phased section names the overview path
	expect(invocation.prompt.includes('`/repo/.lightsout/plans/foo/overview.md`')).toBeTruthy();
	// the phase files are directed into the overview's directory
	expect(invocation.prompt.includes('`/repo/.lightsout/plans/foo`')).toBeTruthy();
});

test('buildPlanWriterInvocation: a lint command adds the self-lint section verbatim, before the report-contract reminder', () => {
	const lintCommand = 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint --cwd /repo';

	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), lintCommand });

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
		standards: '## Tabs only',
		lintCommand: 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint',
	});

	const order = [
		'# Draft input',
		'## Feature request',
		'## Output files',
		'## Phased authoring',
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

test('buildPlanWriterInvocation: an overview listed after a phase output still drives the phased-authoring section', () => {
	const invocation = buildPlanWriterInvocation({
		facts: facts(),
		decisions: decisions(),
		outputs: [
			{ path: '/repo/.lightsout/plans/bar/phase1-contracts.md', variant: 'phase' },
			{ path: '/repo/.lightsout/plans/bar/overview.md', variant: 'overview' },
		],
	});

	// the overview is found regardless of its position in outputs
	expect(invocation.prompt.includes('## Phased authoring')).toBeTruthy();
	// the phased section names the overview path, not the first output
	expect(invocation.prompt.includes('`/repo/.lightsout/plans/bar/overview.md`')).toBeTruthy();
	// the phase files are directed into the overview's directory
	expect(invocation.prompt.includes('`/repo/.lightsout/plans/bar`')).toBeTruthy();
});

test('buildPlanWriterInvocation: supplemental standards are inlined verbatim in their own section', () => {
	const standards = '## Tabs only\n\nUse tabs, never spaces.';

	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), standards });

	expect(invocation.prompt.includes('## Code standards (supplemental)')).toBeTruthy();
	// the standards text lands verbatim
	expect(invocation.prompt.includes('## Tabs only\n\nUse tabs, never spaces.')).toBeTruthy();
});
