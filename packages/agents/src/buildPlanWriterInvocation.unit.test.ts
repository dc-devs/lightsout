import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecisionsRecord, PlanFacts } from '@lightsout/contracts';
import { buildPlanWriterInvocation } from './index';

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

	assert.ok(invocation.prompt.startsWith('# Draft input'), 'the writer invocation marker leads the prompt');
	assert.ok(invocation.prompt.includes('## Feature request\n\nadd a foo endpoint'));
	assert.ok(invocation.prompt.includes('- /repo/.lightsout/plans/foo/plan.md — variant: single'));
	assert.ok(invocation.prompt.includes('"planName": "foo-endpoint"'), 'the decisions record is inlined as JSON');
	assert.ok(invocation.prompt.includes('"verifiedAt": "2026-07-09T00:00:00.000Z"'), 'the verified facts are inlined as JSON');
	assert.ok(invocation.prompt.includes('one JSON PlanDraftReport object'), 'the report-contract reminder closes the prompt');
	assert.ok(!invocation.prompt.includes('## Phased authoring'), 'no phased section without an overview output');
	assert.ok(!invocation.prompt.includes('## Code standards'), 'no standards section when standards are absent');
	assert.ok(!invocation.prompt.includes('## Self-lint'), 'no self-lint section without a lint command');
});

test('buildPlanWriterInvocation: author-only — no corrective findings surface anywhere in the invocation', () => {
	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput() });

	assert.ok(!invocation.prompt.includes('Structural findings'), 'the prompt carries no corrective findings section');
	assert.ok(!invocation.systemPrompt.includes('Structural findings'), 'the role prompt carries no corrective findings surface');
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

	assert.ok(first.systemPrompt.startsWith('# Role: Plan Writer'), 'the role prompt leads the system prompt');
	assert.ok(first.systemPrompt.includes('\n\n---\n\n# Plan Template\n\n'), 'the template is appended as a labelled section');
	assert.equal(first.systemPrompt, second.systemPrompt, 'the system prompt does not vary with per-invocation input');
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

	assert.ok(invocation.prompt.includes('- /repo/.lightsout/plans/foo/overview.md — variant: overview'));
	assert.ok(invocation.prompt.includes('- /repo/.lightsout/plans/foo/phase1-contracts.md — variant: phase'), 'every output file gets its own bullet');
	assert.ok(invocation.prompt.includes('## Phased authoring'));
	assert.ok(invocation.prompt.includes('`/repo/.lightsout/plans/foo/overview.md`'), 'the phased section names the overview path');
	assert.ok(invocation.prompt.includes('`/repo/.lightsout/plans/foo`'), "the phase files are directed into the overview's directory");
});

test('buildPlanWriterInvocation: a lint command adds the self-lint section verbatim, before the report-contract reminder', () => {
	const lintCommand = 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint --plans /repo/.claude/plans --cwd /repo';

	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), lintCommand });

	assert.ok(invocation.prompt.includes('## Self-lint'));
	assert.ok(invocation.prompt.includes(`\`${lintCommand}\``), 'the exact command lands verbatim in a code span');
	assert.ok(
		invocation.prompt.indexOf('## Self-lint') < invocation.prompt.indexOf('one JSON PlanDraftReport object'),
		'the self-lint step precedes the closing report-contract reminder',
	);
});

test('buildPlanWriterInvocation: supplemental standards are inlined verbatim in their own section', () => {
	const standards = '## Tabs only\n\nUse tabs, never spaces.';

	const invocation = buildPlanWriterInvocation({ facts: facts(), decisions: decisions(), outputs: singleOutput(), standards });

	assert.ok(invocation.prompt.includes('## Code standards (supplemental)'));
	assert.ok(invocation.prompt.includes('## Tabs only\n\nUse tabs, never spaces.'), 'the standards text lands verbatim');
});
