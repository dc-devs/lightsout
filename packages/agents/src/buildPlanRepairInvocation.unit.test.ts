import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecisionsRecord, PlanFacts, StructuralFinding } from '@lightsout/contracts';
import { buildPlanRepairInvocation } from './index';

/** A full StructuralFinding with per-test overrides. */
const finding = (overrides: Partial<StructuralFinding> = {}): StructuralFinding => ({
	check: 'no-placeholders',
	issue: 'unresolved TBD marker',
	location: 'Files to Create',
	fix: 'resolve the TBD from the verified facts',
	...overrides,
});

/** Minimal facts + decisions the repairer receives as reference material. */
const setupRepair = () => {
	const facts: PlanFacts = {
		request: 'add the widget flag',
		areas: [],
		verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
		verifiedAt: '2026-01-01T00:00:00.000Z',
	};
	const decisions: DecisionsRecord = {
		planName: 'widget-flag',
		decisions: [
			{
				source: 'Grill',
				question: 'flag default?',
				options: 'on / off',
				choice: 'off by default',
				rationale: 'safer rollout',
				assumption: false,
			},
		],
	};

	return { facts, decisions };
};

/** The fenced JSON block under a `## <heading>` section of the prompt. */
const jsonBlockUnder = ({ prompt, heading }: { prompt: string; heading: string }) => {
	const match = new RegExp(`## ${heading}\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(prompt);

	assert.ok(match, `prompt has a fenced json block under '## ${heading}'`);

	return JSON.parse(match[1]);
};

test('buildPlanRepairInvocation: the prompt opens with the repair marker and every section the role prompt promises', () => {
	const { facts, decisions } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], facts, decisions });

	assert.ok(prompt.startsWith('# Repair input'), 'the marker runPlanDraft keys repair invocations off');
	assert.ok(prompt.includes('## Plan files to repair (Edit in place)'));
	assert.ok(prompt.includes('## Structural findings to resolve'));
	assert.ok(prompt.includes('## Decisions record (reference)'));
	assert.ok(prompt.includes('## Verified facts (reference)'));
	assert.match(prompt, /PlanFixReport/, 'the closing reminder names the report contract');
});

test('buildPlanRepairInvocation: plan paths render as `- <path>` bullets, one per file', () => {
	const { facts, decisions } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({
		findings: [finding()],
		planPaths: ['/tmp/plans/overview.md', '/tmp/plans/phase1-core.md'],
		facts,
		decisions,
	});

	assert.ok(prompt.includes('- /tmp/plans/overview.md\n- /tmp/plans/phase1-core.md'), 'each plan file gets its own bullet');
	// The `- <path>` bullet is the cross-file contract: the writer's output lines
	// and the repairer's plan-file bullets share it, so one prompt parser reads both.
	assert.equal(/- (\S+\.md)/.exec(prompt)?.[1], '/tmp/plans/overview.md');
});

test('buildPlanRepairInvocation: each finding carries its check, location, issue, and exact fix string', () => {
	const { facts, decisions } = setupRepair();
	const findings = [
		finding(),
		finding({ check: 'sections-present', issue: 'Verification section missing', location: 'end of plan', fix: 'add a ## Verification section' }),
	];

	const { prompt } = buildPlanRepairInvocation({ findings, planPaths: ['/tmp/plans/widget-flag.md'], facts, decisions });

	assert.ok(prompt.includes('- [no-placeholders] Files to Create — unresolved TBD marker\n  fix: resolve the TBD from the verified facts'));
	assert.ok(prompt.includes('- [sections-present] end of plan — Verification section missing\n  fix: add a ## Verification section'));
});

test('buildPlanRepairInvocation: decisions and facts round-trip through their reference blocks intact', () => {
	const { facts, decisions } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], facts, decisions });

	assert.deepEqual(jsonBlockUnder({ prompt, heading: 'Decisions record \\(reference\\)' }), decisions);
	assert.deepEqual(jsonBlockUnder({ prompt, heading: 'Verified facts \\(reference\\)' }), facts);
});

test('buildPlanRepairInvocation: the system prompt is the repairer role and the plan template is absent — edit, never re-author', () => {
	const { facts, decisions } = setupRepair();

	const { systemPrompt, prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], facts, decisions });

	assert.match(systemPrompt, /Plan Repairer/);
	assert.match(systemPrompt, /minimal edits/i, 'the hard rule against restructuring is in the role');
	assert.ok(!systemPrompt.includes('# Plan Template'), 'no authoring template for a repair role');
	assert.ok(!prompt.includes('# Draft input'), 'a repair invocation can never read as an author invocation');
});
