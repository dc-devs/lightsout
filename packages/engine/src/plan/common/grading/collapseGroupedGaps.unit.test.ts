import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import { collapseGroupedGaps } from '#src/plan/common/grading/collapseGroupedGaps.ts';

/** One reader's report of the shared contradiction, at the plan file and in the wording each case varies. */
const buildObservation = ({ phase, lens, gap }: { phase: string; lens: GapCheckLens; gap: string }): GapObservation => ({
	area: GapArea.PhaseSeamMismatch,
	gap,
	decision: 'which phase owns the retry timeout',
	options: ['phase 1 owns it', 'phase 2 owns it'],
	phase,
	lens,
});

/**
 * Two blocking gaps of record `f1` with an unrelated gap between them. The
 * second member repeats the first member's observation verbatim and adds its
 * own, so the union has exactly one duplicate to drop.
 */
const setupBlockingMembers = () => {
	const firstObservation = buildObservation({
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Wiring,
		gap: 'phase 1 says the retry timeout is thirty seconds',
	});
	const secondObservation = buildObservation({
		phase: 'phase2-runner.md',
		lens: GapCheckLens.Decisions,
		gap: 'phase 2 says the retry timeout is sixty seconds',
	});

	const first: GradedGap = {
		...firstObservation,
		outcome: GapOutcome.NeedsAHuman,
		humanDecision: 'pick one retry timeout for both phases',
		findingId: 'f1',
		groupId: 'g1',
		sharedDefect: 'the two phases disagree on the retry timeout',
		observations: [firstObservation],
	};
	const unrelated: GradedGap = {
		area: GapArea.OmittedDecision,
		gap: 'the plan never says what an empty manifest means',
		decision: 'what to return for an empty manifest',
		options: [],
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Surface,
		outcome: GapOutcome.Unjudged,
		unjudgedReason: 'the judge spawn failed',
		observations: [],
	};
	const second: GradedGap = {
		...secondObservation,
		outcome: GapOutcome.NeedsAHuman,
		humanDecision: 'pick one retry timeout for both phases',
		findingId: 'f1',
		groupId: 'g1',
		sharedDefect: 'the two phases disagree on the retry timeout',
		observations: [firstObservation, secondObservation],
	};

	return { gaps: [first, unrelated, second], first, unrelated, firstObservation, secondObservation };
};

/**
 * A non-blocking ruling on record `f1` from this pass, followed by the same
 * record surfaced as an open `needs-a-human` blocker — the order `runGradePass`
 * builds the list in.
 */
const setupMixedSides = () => {
	const noteObservation = buildObservation({ phase: 'phase1-contracts.md', lens: GapCheckLens.Wiring, gap: 'phase 1 leaves the retry timeout to the runner' });
	const blockerObservation = buildObservation({
		phase: 'phase2-runner.md',
		lens: GapCheckLens.Decisions,
		gap: 'phase 2 says the retry timeout is sixty seconds',
	});

	const note: GradedGap = {
		...noteObservation,
		outcome: GapOutcome.AgentCanDecide,
		agentDecision: 'use the runner default',
		safeBecause: 'the runner default is already documented',
		findingId: 'f1',
		observations: [noteObservation],
	};
	const blocker: GradedGap = {
		...blockerObservation,
		outcome: GapOutcome.NeedsAHuman,
		humanDecision: 'pick one retry timeout for both phases',
		findingId: 'f1',
		observations: [blockerObservation],
	};

	return { gaps: [note, blocker], note, blocker };
};

describe('collapseGroupedGaps', () => {
	test('collapses gaps sharing a record into one blocker carrying every observation', () => {
		const { gaps, first, unrelated, firstObservation, secondObservation } = setupBlockingMembers();

		const collapsed = collapseGroupedGaps({ gaps });

		// the survivor keeps the first member's place and fields, and the repeated
		// observation is held once
		expect(collapsed).toEqual([{ ...first, observations: [firstObservation, secondObservation] }, unrelated]);
	});

	test('keeps the blocking and non-blocking sides of one record as separate survivors', () => {
		const { gaps, note, blocker } = setupMixedSides();

		const collapsed = collapseGroupedGaps({ gaps });

		// the note arriving first must not swallow the blocker the open record surfaced
		expect(collapsed).toEqual([note, blocker]);
	});
});
