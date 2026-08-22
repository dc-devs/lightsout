import { expect, test } from '@jest/globals';
import { buildPlanGapCheckInvocation } from '#src/agents/index.ts';
import { GapCheckLens } from '#src/contracts/index.ts';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const lens = GapCheckLens.Surface;

test('buildPlanGapCheckInvocation: the system prompt carries the role, the lens brief, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });

	// the shared role prompt leads the system prompt, and the lens brief follows it
	expect(systemPrompt.startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(systemPrompt.includes('# Your brief: surface')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (context only — do not grade standalone)\n\n${overviewText}`)).toBeTruthy();
	expect(
		systemPrompt.includes(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`),
	).toBeTruthy();
});

test('buildPlanGapCheckInvocation: each lens gets its own brief, and only its own', () => {
	const briefs = [GapCheckLens.Surface, GapCheckLens.Wiring, GapCheckLens.Decisions].map(
		(each) => buildPlanGapCheckInvocation({ planText, lens: each }).systemPrompt,
	);

	expect(briefs[0].includes('# Your brief: surface')).toBeTruthy();
	expect(briefs[1].includes('# Your brief: wiring')).toBeTruthy();
	expect(briefs[2].includes('# Your brief: decisions')).toBeTruthy();
	// a checker told to own one brief must not be handed a second one, or the
	// narrowing the three-lens fan-out depends on is gone
	expect(briefs[0].includes('# Your brief: wiring')).toBeFalsy();
	expect(briefs[1].includes('# Your brief: decisions')).toBeFalsy();
	expect(briefs[2].includes('# Your brief: surface')).toBeFalsy();
});

test('buildPlanGapCheckInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, lens });

	// no overview section for a single-file plan
	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	// no standards section when standards are absent
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
});

test('buildPlanGapCheckInvocation: role, brief, overview, and standards are joined in that order by a `---` rule', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });

	const sections = systemPrompt.split('\n\n---\n\n');

	// exactly four sections, each separated by a horizontal rule
	expect(sections.length).toBe(4);
	expect(sections[0].startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(sections[1].startsWith('# Your brief: surface')).toBeTruthy();
	expect(sections[2]).toBe(`# Overview (context only — do not grade standalone)\n\n${overviewText}`);
	expect(sections[3]).toBe(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`);
});

test('buildPlanGapCheckInvocation: the system prompt is byte-identical across the spawns of one lens', () => {
	const first = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });
	const second = buildPlanGapCheckInvocation({ planText: '# Phase 2\n\nsomething else entirely', overviewText, standards, lens });

	// only the plan under check varies between the phase spawns sharing a lens,
	// which is what the harness's prompt cache is paid for
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanGapCheckInvocation: the user prompt is the plan under check plus the report reminder — nothing cacheable', () => {
	const { prompt } = buildPlanGapCheckInvocation({ planText, overviewText, standards, lens });

	// the marker runPlanGrade keys gap-check invocations off
	expect(prompt.startsWith('# Gap-check input')).toBeTruthy();
	expect(prompt.includes(`## Plan to check\n\n${planText}`)).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON GapCheckReport object')).toBeTruthy();
	// the overview is paid for once, in the cached system prompt
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
	// and the lens never leaks into the per-spawn half either
	expect(prompt.includes('# Your brief')).toBeFalsy();
});

test('buildPlanGapCheckInvocation: the standards section follows the brief directly when no overview is given', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, standards, lens });

	const sections = systemPrompt.split('\n\n---\n\n');

	// role, brief and standards only — the two optional sections are gated independently
	expect(sections.length).toBe(3);
	expect(sections[0].startsWith('# Role: Check Plan Gaps')).toBeTruthy();
	expect(sections[1].startsWith('# Your brief: surface')).toBeTruthy();
	expect(sections[2]).toBe(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`);
});

test('buildPlanGapCheckInvocation: an empty overview and empty standards add no sections', () => {
	const { systemPrompt } = buildPlanGapCheckInvocation({ planText, overviewText: '', standards: '', lens });

	// empty text is nothing to grade against, so neither heading is emitted
	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
	// the role and its brief remain — a checker is never spawned without a job
	expect(systemPrompt.split('\n\n---\n\n').length).toBe(2);
});
