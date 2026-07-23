import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlanDedupInvocation } from './index';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const candidates = () => [{ plannedSymbol: 'formatDate', collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }] }];

test('buildPlanDedupInvocation: the system prompt carries the role, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanDedupInvocation({ planText, overviewText, candidates: candidates(), standards });

	assert.ok(systemPrompt.startsWith('# Role: Judge Plan Dedup'), 'the role prompt leads the system prompt');
	assert.ok(systemPrompt.includes(`# Overview (context only — do not judge standalone)\n\n${overviewText}`));
	assert.ok(systemPrompt.includes(`# Code standards\n\nThe implementing agent loads these too — factor them into extract/reuse recommendations:\n\n${standards}`));
});

test('buildPlanDedupInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanDedupInvocation({ planText, candidates: candidates() });

	assert.ok(!systemPrompt.includes('# Overview (context only'), 'no overview section for a single-file plan');
	assert.ok(!systemPrompt.includes('# Code standards'), 'no standards section when standards are absent');
});

test('buildPlanDedupInvocation: the system prompt is byte-identical across judgments in one run', () => {
	const first = buildPlanDedupInvocation({ planText, overviewText, candidates: candidates(), standards });
	const second = buildPlanDedupInvocation({
		planText: '# Phase 2\n\nsomething else entirely',
		overviewText,
		candidates: [{ plannedSymbol: 'parseAction', collidesWith: [{ name: 'parseAction', path: 'src/common/utils/parseAction.ts' }] }],
		standards,
	});

	assert.equal(first.systemPrompt, second.systemPrompt, 'neither the plan nor the collisions can break the cached prefix');
});

test('buildPlanDedupInvocation: the user prompt carries the plan and each detected collision as a bullet', () => {
	const { prompt } = buildPlanDedupInvocation({
		planText,
		overviewText,
		candidates: [{ plannedSymbol: 'formatDate', collidesWith: [{ name: 'formatDate', path: 'a.ts' }, { name: 'formatDate', path: 'b.ts' }] }],
		standards,
	});

	assert.ok(prompt.startsWith('# Dedup input'), 'the marker runPlanDedup keys dedup invocations off');
	assert.ok(prompt.includes(`## Plan to judge\n\n${planText}`));
	assert.ok(prompt.includes('## Detected name collisions\n\n- `formatDate` collides with: formatDate → a.ts; formatDate → b.ts'));
	assert.ok(prompt.includes('one JSON DedupJudgment object'), 'the report-contract reminder closes the prompt');
	assert.ok(!prompt.includes('OVERVIEW-SENTINEL'), 'the overview is paid for once, in the cached system prompt');
	assert.ok(!prompt.includes('STANDARDS-SENTINEL'), 'the standards are paid for once, in the cached system prompt');
});
