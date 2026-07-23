import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlanGapCheckInvocation } from './index';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';

test('buildPlanGapCheckInvocation: the system prompt carries the role, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards });

	assert.ok(systemPrompt.startsWith('# Role: Check Plan Gaps'), 'the role prompt leads the system prompt');
	assert.ok(systemPrompt.includes(`# Overview (context only — do not grade standalone)\n\n${overviewText}`));
	assert.ok(systemPrompt.includes(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`));
});

test('buildPlanGapCheckInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText });

	assert.ok(!systemPrompt.includes('# Overview (context only'), 'no overview section for a single-file plan');
	assert.ok(!systemPrompt.includes('# Code standards'), 'no standards section when standards are absent');
});

test('buildPlanGapCheckInvocation: the system prompt is byte-identical across the phase spawns of one grade run', () => {
	const first = buildPlanGapCheckInvocation({ planText, overviewText, standards });
	const second = buildPlanGapCheckInvocation({ planText: '# Phase 2\n\nsomething else entirely', overviewText, standards });

	assert.equal(first.systemPrompt, second.systemPrompt, 'only the plan under check varies between phase spawns');
});

test('buildPlanGapCheckInvocation: the user prompt is the plan under check plus the report reminder — nothing cacheable', () => {
	const { prompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards });

	assert.ok(prompt.startsWith('# Gap-check input'), 'the marker runPlanGrade keys gap-check invocations off');
	assert.ok(prompt.includes(`## Plan to check\n\n${planText}`));
	assert.ok(prompt.includes('one JSON GapCheckReport object'), 'the report-contract reminder closes the prompt');
	assert.ok(!prompt.includes('OVERVIEW-SENTINEL'), 'the overview is paid for once, in the cached system prompt');
	assert.ok(!prompt.includes('STANDARDS-SENTINEL'), 'the standards are paid for once, in the cached system prompt');
});
