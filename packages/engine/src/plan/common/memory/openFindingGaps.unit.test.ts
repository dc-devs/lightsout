import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradedGap, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { openFindingGaps } from '#src/plan/common/memory/openFindingGaps.ts';

/**
 * One `open` `needs-a-human` record per id given, plus the gaps this pass
 * already produced — each stamped with the record id a judge matched it to, so
 * a test can vary only the ruling that carries the id.
 */
const setupMemory = ({ openIds, judged = [] }: { openIds: string[]; judged?: { findingId: string; outcome: GapOutcome }[] }) => {
	const findings: GradeFindingRecord[] = openIds.map((id) => ({
		id,
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: `gap for ${id}`,
		decision: `decision for ${id}`,
		options: ['keep it', 'drop it'],
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status: GradeFindingStatus.Open,
		disposition: GapOutcome.NeedsAHuman,
		humanDecision: `a human must settle ${id}`,
		reopened: [],
	}));

	const memory: GradeMemory = {
		planName: 'lo-126-plan-regrading-repeats-resolved',
		findings,
		nextFindingNumber: findings.length + 1,
		updatedAt: '2026-09-07T00:00:00.000Z',
	};

	const gaps: GradedGap[] = judged.map(({ findingId, outcome }) => ({
		area: GapArea.OmittedDecision,
		gap: `re-reported ${findingId}`,
		decision: `decision for ${findingId}`,
		options: [],
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Decisions,
		outcome,
		findingId,
	}));

	return { memory, gaps };
};

describe('openFindingGaps', () => {
	test('an open record blocks even when no reader re-reported it', () => {
		const { memory, gaps } = setupMemory({ openIds: ['f1'] });

		const surfaced = openFindingGaps({ memory, gaps });

		// a reader's silence is not evidence the question was answered, so the record
		// has to arrive on the gap list itself to keep blocking
		expect(surfaced).toEqual([
			expect.objectContaining({
				findingId: 'f1',
				outcome: GapOutcome.NeedsAHuman,
				phase: 'phase1-contracts.md',
				area: GapArea.OmittedDecision,
				gap: 'gap for f1',
				decision: 'decision for f1',
				options: ['keep it', 'drop it'],
				humanDecision: 'a human must settle f1',
			}),
		]);
	});

	test('a record a blocking judged gap already carries is not added again', () => {
		const { memory, gaps } = setupMemory({
			openIds: ['f1', 'f2'],
			judged: [{ findingId: 'f1', outcome: GapOutcome.NeedsAHuman }],
		});

		const surfaced = openFindingGaps({ memory, gaps });

		expect(surfaced.map((gap) => gap.findingId)).toStrictEqual(['f2']);
	});

	test('a record the re-verification judge refused to close carries the reason it stayed open', () => {
		const { memory, gaps } = setupMemory({ openIds: ['f1', 'f2'] });
		const refusals = new Map([['f1', 'citation not found in the plan text: ## Decision Log']]);

		const surfaced = openFindingGaps({ memory, gaps, refusals });

		// the note is why a human is still being asked this question, so it has to
		// ride the gap rather than stay in the memory where nobody reads it
		expect(surfaced.map(({ findingId, unjudgedReason }) => ({ findingId, unjudgedReason }))).toStrictEqual([
			{ findingId: 'f1', unjudgedReason: 'citation not found in the plan text: ## Decision Log' },
			{ findingId: 'f2', unjudgedReason: undefined },
		]);
		// and it changes nothing about whether the record blocks — only the
		// re-verification judge closes one
		expect(surfaced.map(({ outcome }) => outcome)).toStrictEqual([GapOutcome.NeedsAHuman, GapOutcome.NeedsAHuman]);
	});

	test('an open record is surfaced beside a non-blocking gap that carries its id', () => {
		const { memory, gaps } = setupMemory({
			openIds: ['f1'],
			judged: [{ findingId: 'f1', outcome: GapOutcome.AlreadyAnswered }],
		});

		const surfaced = openFindingGaps({ memory, gaps });

		// only the re-verification judge closes a record, so a fresh judge's note
		// must not hide the open one for a pass
		expect(surfaced).toEqual([expect.objectContaining({ findingId: 'f1', outcome: GapOutcome.NeedsAHuman, gap: 'gap for f1' })]);
	});
});
