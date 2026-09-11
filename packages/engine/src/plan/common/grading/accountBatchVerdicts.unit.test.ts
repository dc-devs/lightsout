import { describe, expect, test } from '@jest/globals';
import { GapArea, type GapBatchVerdict, GapCheckLens, type GapGroupVerdict, type GapObservation, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { accountBatchVerdicts } from '#src/plan/common/grading/accountBatchVerdicts.ts';
import type { GapBatch } from '#src/plan/common/types/GapBatch.ts';
import type { GapRuling } from '#src/plan/common/types/GapRuling.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const firstFile = 'phase1-batching.md';
const secondFile = 'phase2-closure.md';

/** A line each plan file really states, long enough that `confirmCitation` accepts it as a quote rather than a path. */
const firstAnswer = 'The judge that times out leaves its own record open and blocking.';
const secondAnswer = 'A grouped record closes only once every location holds a confirmed citation.';

const planFiles: Record<string, string> = {
	[firstFile]: `# Phase 1\n\n${firstAnswer}\n`,
	[secondFile]: `# Phase 2\n\n${secondAnswer}\n`,
};

/**
 * The batch sits mid-pass: its findings are the pass's fifth onward, so a ruling
 * keyed by its position in the batch rather than by the finding's `index` lands
 * on the wrong key.
 */
const firstIndex = 4;

/** One reader's report at one plan file. */
const observationAt = ({ phase }: { phase: string }): GapObservation => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: [],
	phase,
	lens: GapCheckLens.Decisions,
});

/** One finding as the batching stage hands it over: labelled, and unjudged until a judge says otherwise. */
const gapOf = (overrides: Partial<GradedGap> = {}): GradedGap => ({
	...observationAt({ phase: firstFile }),
	outcome: GapOutcome.Unjudged,
	observations: [],
	...overrides,
});

/** One ruling carrying the evidence `needs-a-human` demands unless a case replaces it. */
const ruling = (overrides: Partial<GapGroupVerdict> = {}): GapGroupVerdict => ({
	outcome: GapOutcome.NeedsAHuman,
	humanDecision: 'pick the failure mode',
	covers: [],
	answers: [],
	...overrides,
});

/** A judge that answered for its batch with these rulings. */
const judged = ({ verdicts }: { verdicts: GapGroupVerdict[] }): AgentOutcome<GapBatchVerdict> => ({ ok: true, report: { verdicts } });

/**
 * A batch built the way `groupGapCandidates` builds one: ids `o1`, `o2`, … in
 * finding order, and one plan text per location its findings span — their
 * observations' phases, or their own phase when they carry none.
 */
const setupBatch = async ({ gaps, recordIds = new Set<string>() }: { gaps: GradedGap[]; recordIds?: Set<string> }) => {
	const cwd = await freshCwd();
	const locations = [...new Set(gaps.flatMap(({ observations, phase }) => (observations.length > 0 ? observations.map((seen) => seen.phase) : [phase])))];
	const batch: GapBatch = {
		observations: gaps.map((gap, position) => ({ id: `o${position + 1}`, index: firstIndex + position, gap })),
		planTexts: locations.map((phase) => ({ phase, text: planFiles[phase] ?? '' })),
	};

	return { cwd, batch, recordIds };
};

/** What the join makes of each ruling, in the order it reads one: a reason means unjudged, whatever else the ruling holds. */
const settledAs = ({ rulings }: { rulings: Map<number, GapRuling> }) =>
	Object.fromEntries(
		[...rulings].map(([index, settled]) => [
			index,
			settled.unjudgedReason === undefined ? { outcome: settled.verdict?.outcome } : { outcome: GapOutcome.Unjudged, reason: settled.unjudgedReason },
		]),
	);

describe('accountBatchVerdicts', () => {
	test('leaves an observation no verdict covered unjudged while the covered pair stands', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ gap: 'first' }), gapOf({ gap: 'second' }), gapOf({ gap: 'third' })] });
		const outcome = judged({ verdicts: [ruling({ covers: ['o1', 'o2'], sharedDefect: 'the plan never picks a failure mode' })] });

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// every observation the batch supplied comes back, so an uncovered one blocks rather than vanishing
		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.NeedsAHuman },
			5: { outcome: GapOutcome.NeedsAHuman },
			6: { outcome: GapOutcome.Unjudged, reason: expect.stringMatching(/cover/i) },
		});
		expect(rulings.get(4)?.groupId).toEqual(expect.any(String));
		expect(rulings.get(5)?.groupId).toBe(rulings.get(4)?.groupId);
	});

	test('leaves a doubly covered observation unjudged and lets the unambiguous ruling stand', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ gap: 'first' }), gapOf({ gap: 'second' }), gapOf({ gap: 'third' })] });
		const outcome = judged({
			verdicts: [
				ruling({
					outcome: GapOutcome.AgentCanDecide,
					humanDecision: undefined,
					agentDecision: 'return null',
					safeBecause: 'the standards settle it',
					covers: ['o1', 'o2'],
					sharedDefect: 'the plan never picks a failure mode',
				}),
				ruling({ covers: ['o2', 'o3'], sharedDefect: 'the plan never names who owns the timeout' }),
			],
		});

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// o2 cannot be attributed to either ruling, so it blocks; o1 and o3 each have exactly one
		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.AgentCanDecide },
			5: { outcome: GapOutcome.Unjudged, reason: expect.stringMatching(/more than one|twice|double/i) },
			6: { outcome: GapOutcome.NeedsAHuman },
		});
	});

	test('voids a verdict naming an unknown identifier without discarding its sibling', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ gap: 'first' }), gapOf({ gap: 'second' })] });
		const outcome = judged({
			verdicts: [
				ruling({ covers: ['o1', 'o9'], sharedDefect: 'the plan never picks a failure mode' }),
				ruling({
					outcome: GapOutcome.AgentCanDecide,
					humanDecision: undefined,
					agentDecision: 'return null',
					safeBecause: 'the standards settle it',
					covers: ['o2'],
				}),
			],
		});

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.Unjudged, reason: expect.stringContaining('o9') },
			5: { outcome: GapOutcome.AgentCanDecide },
		});
	});

	test('refuses a two-file dismissal that cites only one file', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ phase: firstFile }), gapOf({ phase: secondFile })] });
		const outcome = judged({
			verdicts: [
				ruling({
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					covers: ['o1', 'o2'],
					sharedDefect: 'the two phases disagree on what a timed-out judge leaves behind',
					answers: [{ phase: firstFile, answerAt: firstAnswer }],
				}),
			],
		});

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// the citation for the first file is real, yet it says nothing about the second
		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.Unjudged, reason: expect.stringContaining(secondFile) },
			5: { outcome: GapOutcome.Unjudged, reason: expect.stringContaining(secondFile) },
		});
	});

	test('demands a citation per carried location, not per gap phase', async () => {
		const carried = [observationAt({ phase: firstFile }), observationAt({ phase: secondFile })];
		const { cwd, batch, recordIds } = await setupBatch({
			gaps: [gapOf({ phase: firstFile, observations: carried }), gapOf({ phase: firstFile, observations: carried })],
		});
		const outcome = judged({
			verdicts: [
				ruling({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, covers: ['o1'], answers: [{ phase: firstFile, answerAt: firstAnswer }] }),
				ruling({
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					covers: ['o2'],
					answers: [
						{ phase: firstFile, answerAt: firstAnswer },
						{ phase: secondFile, answerAt: secondAnswer },
					],
				}),
			],
		});

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// both gaps name only the first file as their phase, but each carries an observation in the second
		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.Unjudged, reason: expect.stringContaining(secondFile) },
			5: { outcome: GapOutcome.AlreadyAnswered },
		});
	});

	test('requires a shared-defect statement before believing a multi-observation ruling', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ gap: 'first' }), gapOf({ gap: 'second' }), gapOf({ gap: 'third' })] });
		const outcome = judged({ verdicts: [ruling({ covers: ['o1', 'o2'], sharedDefect: '   ' }), ruling({ covers: ['o3'], sharedDefect: '   ' })] });

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// a group is the judge's claim of one defect, and a claim with no statement of that defect is a rubber stamp
		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.Unjudged, reason: expect.stringMatching(/shared.?defect/i) },
			5: { outcome: GapOutcome.Unjudged, reason: expect.stringMatching(/shared.?defect/i) },
			6: { outcome: GapOutcome.NeedsAHuman },
		});
	});

	test('refuses a verdict matching a record the plan does not hold', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ gap: 'first' }), gapOf({ gap: 'second' })], recordIds: new Set(['f1']) });
		const outcome = judged({ verdicts: [ruling({ covers: ['o1', 'o2'], sharedDefect: 'the plan never picks a failure mode', matchesFinding: 'f9' })] });

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.Unjudged, reason: expect.stringContaining('f9') },
			5: { outcome: GapOutcome.Unjudged, reason: expect.stringContaining('f9') },
		});
	});

	test('hands each member of a two-file dismissal the citation for its own plan file', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ phase: firstFile }), gapOf({ phase: secondFile })] });
		const outcome = judged({
			verdicts: [
				ruling({
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					covers: ['o1', 'o2'],
					sharedDefect: 'the two phases disagree on what a timed-out judge leaves behind',
					answers: [
						{ phase: secondFile, answerAt: secondAnswer },
						{ phase: firstFile, answerAt: firstAnswer },
					],
				}),
			],
		});

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// each member's citation is the one confirmed against its own file, whatever order the judge listed them in
		expect(settledAs({ rulings })).toEqual({ 4: { outcome: GapOutcome.AlreadyAnswered }, 5: { outcome: GapOutcome.AlreadyAnswered } });
		expect([rulings.get(4)?.answerAt, rulings.get(5)?.answerAt]).toStrictEqual([firstAnswer, secondAnswer]);
		expect(rulings.get(4)?.observations?.map(({ phase }) => phase)).toStrictEqual([firstFile, secondFile]);
	});

	test('refuses a dismissal that cites one plan file twice', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ phase: firstFile })] });
		const outcome = judged({
			verdicts: [
				ruling({
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					covers: ['o1'],
					answers: [
						{ phase: firstFile, answerAt: firstAnswer },
						{ phase: firstFile, answerAt: 'a second, different reading of the same file' },
					],
				}),
			],
		});

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// two citations for one file leave the engine to pick which to believe, so neither is
		expect(settledAs({ rulings })).toEqual({ 4: { outcome: GapOutcome.Unjudged, reason: expect.stringMatching(/more than once|twice|repeat/i) } });
	});

	test('refuses a dismissal citing a plan file the batch holds no text for', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ phase: firstFile })] });
		const outcome = judged({
			verdicts: [
				ruling({
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					covers: ['o1'],
					answers: [
						{ phase: firstFile, answerAt: firstAnswer },
						{ phase: secondFile, answerAt: secondAnswer },
					],
				}),
			],
		});

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome, recordIds });

		// the judge was never given the second file's text, so a citation there is one the engine cannot confirm
		expect(settledAs({ rulings })).toEqual({ 4: { outcome: GapOutcome.Unjudged, reason: expect.stringMatching(/phase2-closure\.md.*no text/) } });
	});

	test('leaves every observation of an unstarted batch unjudged with the skip reason', async () => {
		const { cwd, batch, recordIds } = await setupBatch({ gaps: [gapOf({ gap: 'first' }), gapOf({ gap: 'second' })] });
		const noJudgeReason = 'the reader fan-out hit the rate-limit wall, so no judge was spawned';

		const rulings = await accountBatchVerdicts({ cwd, batch, outcome: undefined, recordIds, noJudgeReason });

		expect(settledAs({ rulings })).toEqual({
			4: { outcome: GapOutcome.Unjudged, reason: noJudgeReason },
			5: { outcome: GapOutcome.Unjudged, reason: noJudgeReason },
		});
	});
});
