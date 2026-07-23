import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StructuralFinding } from '@lightsout/contracts';
import { buildPlanRepairInvocation } from './index';

/** A full StructuralFinding with per-test overrides. */
const finding = (overrides: Partial<StructuralFinding> = {}): StructuralFinding => ({
	check: 'no-placeholders',
	issue: 'unresolved TBD marker',
	location: 'Files to Create',
	fix: 'resolve the TBD from the verified facts',
	...overrides,
});

/** The workspace reference paths the repairer Reads on demand. */
const setupRepair = () => ({
	decisionsPath: '/tmp/.lightsout/plans/widget-flag/decisions.json',
	factsPath: '/tmp/.lightsout/plans/widget-flag/facts.json',
});

test('buildPlanRepairInvocation: the prompt opens with the repair marker and every section the role prompt promises', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	assert.ok(prompt.startsWith('# Repair input'), 'the marker runPlanDraft keys repair invocations off');
	assert.ok(prompt.includes('## Plan files to repair (Edit in place)'));
	assert.ok(prompt.includes('## Structural findings to resolve'));
	assert.ok(prompt.includes('## Reference files (Read on demand)'));
	assert.match(prompt, /PlanFixReport/, 'the closing reminder names the report contract');
});

test('buildPlanRepairInvocation: plan paths render as `- <path>` bullets, one per file', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({
		findings: [finding()],
		planPaths: ['/tmp/plans/overview.md', '/tmp/plans/phase1-core.md'],
		decisionsPath,
		factsPath,
	});

	assert.ok(prompt.includes('- /tmp/plans/overview.md\n- /tmp/plans/phase1-core.md'), 'each plan file gets its own bullet');
	// The `- <path>` bullet is the cross-file contract: the writer's output lines
	// and the repairer's plan-file bullets share it, so one prompt parser reads both.
	assert.equal(/- (\S+\.md)/.exec(prompt)?.[1], '/tmp/plans/overview.md');
});

test('buildPlanRepairInvocation: each finding carries its check, location, issue, and exact fix string', () => {
	const { decisionsPath, factsPath } = setupRepair();
	const findings = [
		finding(),
		finding({ check: 'sections-present', issue: 'Verification section missing', location: 'end of plan', fix: 'add a ## Verification section' }),
	];

	const { prompt } = buildPlanRepairInvocation({ findings, planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	assert.ok(prompt.includes('- [no-placeholders] Files to Create — unresolved TBD marker\n  fix: resolve the TBD from the verified facts'));
	assert.ok(prompt.includes('- [sections-present] end of plan — Verification section missing\n  fix: add a ## Verification section'));
});

test('buildPlanRepairInvocation: decisions and facts arrive as paths to Read, never as inlined content', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	assert.ok(prompt.includes(`- Decisions record: ${decisionsPath}`), 'the decisions record renders as a path bullet');
	assert.ok(prompt.includes(`- Verified facts: ${factsPath}`), 'the verified facts render as a path bullet');
	assert.ok(!prompt.includes('```json'), 'no reference content rides the prompt — a mechanical repair never pays for it');
});

test('buildPlanRepairInvocation: the system prompt is the repairer role and the plan template is absent — edit, never re-author', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { systemPrompt, prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	assert.match(systemPrompt, /Plan Repairer/);
	assert.match(systemPrompt, /minimal edits/i, 'the hard rule against restructuring is in the role');
	assert.ok(!systemPrompt.includes('# Plan Template'), 'no authoring template for a repair role');
	assert.ok(!prompt.includes('# Draft input'), 'a repair invocation can never read as an author invocation');
});
