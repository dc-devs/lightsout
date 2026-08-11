import { expect, test } from '@jest/globals';
import { buildPlanGapCheckInvocation } from '@/agents';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';

test('buildPlanGapCheckInvocation: the system prompt carries the role, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (context only — do not grade standalone)\n\n${overviewText}`)).toBeTruthy();
	expect(
		systemPrompt.includes(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`),
	).toBeTruthy();
});

test('buildPlanGapCheckInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText });

	// no overview section for a single-file plan
	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	// no standards section when standards are absent
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
});

test('buildPlanGapCheckInvocation: role, overview, and standards are joined in that order by a `---` rule', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards });

	const sections = systemPrompt.split('\n\n---\n\n');

	// exactly three sections, each separated by a horizontal rule
	expect(sections.length).toBe(3);
	// the role prompt is the first section
	expect(sections[0].startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(sections[1]).toBe(`# Overview (context only — do not grade standalone)\n\n${overviewText}`);
	expect(sections[2]).toBe(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`);
});

test('buildPlanGapCheckInvocation: the system prompt is byte-identical across the phase spawns of one grade run', () => {
	const first = buildPlanGapCheckInvocation({ planText, overviewText, standards });
	const second = buildPlanGapCheckInvocation({ planText: '# Phase 2\n\nsomething else entirely', overviewText, standards });

	// only the plan under check varies between phase spawns
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanGapCheckInvocation: the user prompt is the plan under check plus the report reminder — nothing cacheable', () => {
	const { prompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards });

	// the marker runPlanGrade keys gap-check invocations off
	expect(prompt.startsWith('# Gap-check input')).toBeTruthy();
	expect(prompt.includes(`## Plan to check\n\n${planText}`)).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON GapCheckReport object')).toBeTruthy();
	// the overview is paid for once, in the cached system prompt
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});
