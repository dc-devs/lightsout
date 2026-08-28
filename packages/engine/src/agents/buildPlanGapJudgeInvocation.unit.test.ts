import { expect, test } from '@jest/globals';
import { buildPlanGapJudgeInvocation } from '#src/agents/index.ts';
import { GapArea, GapCheckLens, GapOutcome, type GradedGap } from '#src/contracts/index.ts';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';

/** One reader finding as the fold stamps it, before any judge has weighed it. */
const gapOf = (overrides: Partial<GradedGap> = {}): GradedGap => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: ['throw', 'return null'],
	phase: 'phase1-core.md',
	lens: GapCheckLens.Decisions,
	outcome: GapOutcome.Unjudged,
	...overrides,
});

test('buildPlanGapJudgeInvocation: the system prompt carries the role, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanGapJudgeInvocation({ planText, overviewText, standards, gap: gapOf() });

	expect(systemPrompt.startsWith('# Role: Judge a Plan Gap')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (context only — do not judge standalone)\n\n${overviewText}`)).toBeTruthy();
	expect(
		systemPrompt.includes(
			`# Code standards\n\nThe implementing agent loads these too — they are part of what it could derive the answer from:\n\n${standards}`,
		),
	).toBeTruthy();
});

test('buildPlanGapJudgeInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanGapJudgeInvocation({ planText, gap: gapOf() });

	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
});

test('buildPlanGapJudgeInvocation: the system prompt is byte-identical across the judges of one run', () => {
	const first = buildPlanGapJudgeInvocation({ planText, overviewText, standards, gap: gapOf() });
	const second = buildPlanGapJudgeInvocation({ planText: '# Phase 2\n\nsomething else', overviewText, standards, gap: gapOf({ gap: 'another finding' }) });

	// neither the plan nor the finding can break the cached prefix
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanGapJudgeInvocation: the task prompt carries the plan and the one finding under judgment', () => {
	const { prompt } = buildPlanGapJudgeInvocation({ planText, overviewText, standards, gap: gapOf() });

	// the marker the stub driver tells a judge from a reader by
	expect(prompt.startsWith('# Gap-judge input')).toBeTruthy();
	expect(prompt.includes('# Gap-check input')).toBeFalsy();
	expect(prompt.includes(`## Plan the finding was raised against\n\n${planText}`)).toBeTruthy();
	expect(prompt.includes('- area: omitted-decision')).toBeTruthy();
	expect(prompt.includes('- lens: decisions')).toBeTruthy();
	expect(prompt.includes('- finding: the plan picks no failure mode')).toBeTruthy();
	expect(prompt.includes('- the reader says this must be decided: what to return when the judge times out')).toBeTruthy();
	expect(prompt.includes('- options the reader offered: throw / return null')).toBeTruthy();
	expect(prompt.includes('one JSON GapVerdict object')).toBeTruthy();
	// the overview and the standards are paid for once, in the cached system prompt
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});

test('buildPlanGapJudgeInvocation: a finding whose reader offered no options says so rather than trailing empty', () => {
	const { prompt } = buildPlanGapJudgeInvocation({ planText, gap: gapOf({ options: [] }) });

	expect(prompt.includes('- options the reader offered: none offered')).toBeTruthy();
});

test("buildPlanGapJudgeInvocation: a phased plan's judge is told where the sibling phase files are", () => {
	const { prompt } = buildPlanGapJudgeInvocation({ planText, overviewText, planDir: '.lightsout/plans/web-app-design', gap: gapOf() });

	// a seam finding cannot be settled from one side, and the judge opens the
	// neighbour itself rather than being handed every phase inline
	expect(prompt.includes("## The plan's other phases")).toBeTruthy();
	expect(prompt.includes("The plan's other phase files are in `.lightsout/plans/web-app-design`.")).toBeTruthy();
});

test('buildPlanGapJudgeInvocation: a single-file plan gets no sibling-phases section at all', () => {
	const { prompt } = buildPlanGapJudgeInvocation({ planText, gap: gapOf({ phase: 'plan.md' }) });

	expect(prompt.includes("## The plan's other phases")).toBeFalsy();
});
