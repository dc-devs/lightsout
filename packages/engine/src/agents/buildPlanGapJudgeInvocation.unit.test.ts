import { expect, test } from '@jest/globals';
import { buildPlanGapJudgeInvocation } from '#src/agents/index.ts';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';

/** A batch of the one finding under `o1`, over the one plan file it was raised against — the finding as `observationOf` below builds it. */
const batchOf = (overrides: Partial<GapObservation> = {}) => ({
	planTexts: [{ phase: 'phase1-core.md', text: planText }],
	observations: [{ id: 'o1', observation: observationOf(overrides) }],
});

test('buildPlanGapJudgeInvocation: the system prompt carries the role, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanGapJudgeInvocation({ ...batchOf(), overviewText, standards });

	expect(systemPrompt.startsWith('# Role: Judge a Plan Gap')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (context only — do not judge standalone)\n\n${overviewText}`)).toBeTruthy();
	expect(
		systemPrompt.includes(
			`# Code standards\n\nThe implementing agent loads these too — they are part of what it could derive the answer from:\n\n${standards}`,
		),
	).toBeTruthy();
});

test('buildPlanGapJudgeInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanGapJudgeInvocation(batchOf());

	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
});

test('buildPlanGapJudgeInvocation: the system prompt is byte-identical across the judges of one run', () => {
	const first = buildPlanGapJudgeInvocation({ ...batchOf(), overviewText, standards });
	const second = buildPlanGapJudgeInvocation({
		planTexts: [{ phase: 'phase2-cli.md', text: '# Phase 2\n\nsomething else' }],
		overviewText,
		standards,
		observations: [{ id: 'o2', observation: observationOf({ gap: 'another finding', phase: 'phase2-cli.md' }) }],
	});

	// neither the plan nor the finding can break the cached prefix
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanGapJudgeInvocation: the task prompt carries the plan and the one finding under judgment', () => {
	const { prompt } = buildPlanGapJudgeInvocation({ ...batchOf(), overviewText, standards });

	// the marker the stub driver tells a judge from a reader by
	expect(prompt.startsWith('# Gap-judge input')).toBeTruthy();
	expect(prompt.includes('# Gap-check input')).toBeFalsy();
	expect(prompt.includes(`## Plan file: phase1-core.md\n\n${planText}`)).toBeTruthy();
	expect(prompt.includes('- area: omitted-decision')).toBeTruthy();
	expect(prompt.includes('- lens: decisions')).toBeTruthy();
	expect(prompt.includes('- finding: the plan picks no failure mode')).toBeTruthy();
	expect(prompt.includes('- the reader says this must be decided: what to return when the judge times out')).toBeTruthy();
	expect(prompt.includes('- options the reader offered: throw / return null')).toBeTruthy();
	expect(prompt.includes('one JSON GapBatchVerdict object')).toBeTruthy();
	// the overview and the standards are paid for once, in the cached system prompt
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});

test('buildPlanGapJudgeInvocation: a finding whose reader offered no options says so rather than trailing empty', () => {
	const { prompt } = buildPlanGapJudgeInvocation(batchOf({ options: [] }));

	expect(prompt.includes('- options the reader offered: none offered')).toBeTruthy();
});

test("buildPlanGapJudgeInvocation: a phased plan's judge is told where the sibling phase files are", () => {
	const { prompt } = buildPlanGapJudgeInvocation({ ...batchOf(), overviewText, planDir: '.lightsout/plans/web-app-design' });

	// a seam finding cannot be settled from one side, and the judge opens the
	// neighbour itself rather than being handed every phase inline
	expect(prompt.includes("## The plan's other phases")).toBeTruthy();
	expect(prompt.includes("The plan's other phase files are in `.lightsout/plans/web-app-design`.")).toBeTruthy();
});

test('buildPlanGapJudgeInvocation: a single-file plan gets no sibling-phases section at all', () => {
	const { prompt } = buildPlanGapJudgeInvocation(batchOf({ phase: 'plan.md' }));

	expect(prompt.includes("## The plan's other phases")).toBeFalsy();
});

/** One memory record as `phaseFindingRecords` hands the judge builder its phase's slice. */
const recordOf = (overrides: Partial<GradeFindingRecord> = {}): GradeFindingRecord => ({
	id: 'f1',
	phase: 'phase1-core.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: ['throw', 'return null'],
	firstSeen: '2026-01-01T00:00:00.000Z',
	lastSeen: '2026-01-02T00:00:00.000Z',
	status: GradeFindingStatus.Open,
	disposition: GapOutcome.NeedsAHuman,
	humanDecision: 'pick the failure mode',
	observations: [],
	resolutions: [],
	reopened: [],
	...overrides,
});

test("the judge prompt lists the phase's records and the id rule", () => {
	const records = [
		recordOf({ gap: 'RECORD-ONE-SENTINEL: the plan picks no failure mode' }),
		recordOf({
			id: 'f7',
			gap: 'RECORD-TWO-SENTINEL: the retry count is unstated',
			status: GradeFindingStatus.Resolved,
			disposition: GapOutcome.AlreadyAnswered,
			answerAt: 'Decision Log row 4',
		}),
	];

	const { prompt } = buildPlanGapJudgeInvocation({ ...batchOf(), overviewText, records });

	expect(prompt.includes('## Findings already on record')).toBeTruthy();
	// every record for the phase, each line naming its id beside the state it is in
	expect(prompt).toMatch(/f1.*open/);
	expect(prompt).toMatch(/f7.*resolved/);
	expect(prompt.includes('RECORD-ONE-SENTINEL: the plan picks no failure mode')).toBeTruthy();
	expect(prompt.includes('RECORD-TWO-SENTINEL: the retry count is unstated')).toBeTruthy();
	// the rule that turns the list into an answer the engine can validate
	expect(prompt.includes('matchesFinding')).toBeTruthy();
	// the records are context for the ruling, so they arrive before the finding being ruled on
	expect(prompt.indexOf('## Findings already on record')).toBeLessThan(prompt.indexOf('## The observations to judge'));
});

test('a plan file the memory holds no record for gets no records section', () => {
	const { prompt } = buildPlanGapJudgeInvocation({ ...batchOf(), overviewText, records: [] });

	// an empty heading followed by the `matchesFinding` rule would invite a judge
	// to name an id off a list that has none
	expect(prompt.includes('## Findings already on record')).toBeFalsy();
	expect(prompt.includes('matchesFinding')).toBeFalsy();
	// the finding under judgment is still there — a judge is never spawned without one
	expect(prompt.includes('## The observations to judge')).toBeTruthy();
});

/** One reader's report at one plan file, as a batch hands it to the judge builder. */
const observationOf = (overrides: Partial<GapObservation> = {}): GapObservation => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: ['throw', 'return null'],
	phase: 'phase1-core.md',
	lens: GapCheckLens.Decisions,
	...overrides,
});

test('carries every spanned plan file and every engine identifier in the prompt', () => {
	const planTexts = [
		{ phase: 'phase1-core.md', text: '# Phase 1\n\nPLAN-ONE-SENTINEL' },
		{ phase: 'phase2-cli.md', text: '# Phase 2\n\nPLAN-TWO-SENTINEL' },
	];
	const observations = [
		{ id: 'o1', observation: observationOf({ gap: 'OBSERVATION-ONE-SENTINEL: the timeout is returned as null' }) },
		{
			id: 'o2',
			observation: observationOf({
				phase: 'phase2-cli.md',
				area: GapArea.PhaseSeamMismatch,
				gap: 'OBSERVATION-TWO-SENTINEL: the CLI expects the timeout to throw',
			}),
		},
	];

	const { systemPrompt, prompt } = buildPlanGapJudgeInvocation({ planTexts, overviewText, standards, observations });

	// the marker the stub driver tells a judge from a reader by
	expect(prompt.startsWith('# Gap-judge input')).toBeTruthy();
	// one section per plan file the batch spans, each heading followed by that file's own text
	expect(prompt.includes('## Plan file: phase1-core.md')).toBeTruthy();
	expect(prompt.includes('## Plan file: phase2-cli.md')).toBeTruthy();
	expect(prompt.indexOf('## Plan file: phase1-core.md')).toBeLessThan(prompt.indexOf('PLAN-ONE-SENTINEL'));
	expect(prompt.indexOf('## Plan file: phase2-cli.md')).toBeLessThan(prompt.indexOf('PLAN-TWO-SENTINEL'));
	// every observation arrives under the identifier the engine assigned it, the only names `covers` may use
	expect(prompt.includes('## The observations to judge')).toBeTruthy();
	const observationsSection = prompt.slice(prompt.indexOf('## The observations to judge'));
	expect(observationsSection).toMatch(/\bo1\b[\s\S]*OBSERVATION-ONE-SENTINEL[\s\S]*\bo2\b[\s\S]*OBSERVATION-TWO-SENTINEL/);
	expect(prompt).toMatch(/one JSON GapBatchVerdict object/);
	// the brief, the overview and the standards are paid for once, in the cached system prompt
	expect(systemPrompt).toMatch(/^# Role: /);
	expect(systemPrompt.includes('OVERVIEW-SENTINEL')).toBeTruthy();
	expect(systemPrompt.includes('STANDARDS-SENTINEL')).toBeTruthy();
	expect(prompt.includes('# Role: ')).toBeFalsy();
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});
