import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { pendingFindingGaps } from '#src/plan/common/memory/pendingFindingGaps.ts';

/**
 * A memory holding one `pending` record — no judge disposition, a stored
 * unjudged reason, and observations in two plan files — beside one `open`
 * `needs-a-human` record, so a test can see which state is re-offered to the
 * judge.
 */
const setupMemory = () => {
	const observations: GapObservation[] = [
		{
			phase: 'phase1-contracts.md',
			lens: GapCheckLens.Surface,
			area: GapArea.UnderspecifiedSurface,
			gap: 'the batch verdict names no identifier field',
			decision: 'name the field covers',
			options: ['covers', 'members'],
		},
		{
			phase: 'phase2-grading.md',
			lens: GapCheckLens.Wiring,
			area: GapArea.PhaseSeamMismatch,
			gap: 'the join expects an identifier field the contract never declares',
			decision: 'declare the identifier field in the contract',
			options: [],
		},
	];

	const pending: GradeFindingRecord = {
		id: 'f1',
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Surface,
		area: GapArea.UnderspecifiedSurface,
		gap: 'the batch verdict names no identifier field',
		decision: 'name the field covers',
		options: ['covers', 'members'],
		observations,
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status: GradeFindingStatus.Pending,
		unjudgedReason: 'the judge fan-out stopped before this finding was judged',
		resolutions: [],
		reopened: [],
	};

	const open: GradeFindingRecord = {
		id: 'f2',
		phase: 'phase2-grading.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'the retry budget is never stated',
		decision: 'state the retry budget',
		options: ['one retry', 'none'],
		observations: [],
		firstSeen: '2026-09-02T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status: GradeFindingStatus.Open,
		disposition: GapOutcome.NeedsAHuman,
		humanDecision: 'a human must settle the retry budget',
		resolutions: [],
		reopened: [],
	};

	const memory: GradeMemory = {
		planName: 'lo-133-duplicate-grading-reports-cause',
		findings: [pending, open],
		nextFindingNumber: 3,
		updatedAt: '2026-09-07T00:00:00.000Z',
	};

	return { memory, observations };
};

describe('pendingFindingGaps', () => {
	test('returns every pending record as an unjudged gap and no open record', () => {
		const { memory, observations } = setupMemory();

		const carried = pendingFindingGaps({ memory });

		// a pending finding needs judging, so it rides into the judge batching
		// carrying its own record id; the open record belongs to re-verification
		expect(carried).toEqual([
			expect.objectContaining({
				findingId: 'f1',
				phase: 'phase1-contracts.md',
				lens: GapCheckLens.Surface,
				area: GapArea.UnderspecifiedSurface,
				gap: 'the batch verdict names no identifier field',
				decision: 'name the field covers',
				options: ['covers', 'members'],
				observations,
				unjudgedReason: 'the judge fan-out stopped before this finding was judged',
				outcome: GapOutcome.Unjudged,
			}),
		]);
	});
});
