import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import {
	GapArea,
	GapCheckLens,
	type GapObservation,
	GapOutcome,
	type GradedGap,
	type GradeFindingRecord,
	GradeFindingStatus,
	type GradeMemory,
} from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { openFindingGaps } from '#src/plan/common/memory/openFindingGaps.ts';
import { verifyOpenFindings } from '#src/plan/common/memory/verifyOpenFindings.ts';
import { isBlockingGap } from '#src/plan/common/utils/isBlockingGap.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/** One confirmed group's two observations, across both plan files. */
const groupedObservations: GapObservation[] = [
	{
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'the contracts phase never states the retry budget',
		decision: 'state the retry budget',
		options: [],
	},
	{
		phase: 'phase2-grading.md',
		lens: GapCheckLens.Wiring,
		area: GapArea.PhaseSeamMismatch,
		gap: 'the grading phase retries a judge the contracts phase never budgets for',
		decision: 'state the retry budget once for both phases',
		options: [],
	},
];

/** The defect the judge confirmed that group as. */
const groupedDefect = 'the two phases disagree on the retry budget';

/**
 * One `open` `needs-a-human` record per id given, plus the gaps this pass
 * already produced — each stamped with the record id a judge matched it to, so
 * a test can vary only the ruling that carries the id. `grouped` makes every
 * record a confirmed group: the observations it holds and the defect it was
 * confirmed as.
 */
const setupMemory = ({
	openIds,
	judged = [],
	grouped,
}: {
	openIds: string[];
	judged?: { findingId: string; outcome: GapOutcome }[];
	grouped?: { observations: GapObservation[]; sharedDefect: string };
}) => {
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
		observations: [],
		resolutions: [],
		reopened: [],
		...grouped,
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
		observations: [],
	}));

	return { memory, gaps };
};

/**
 * A memory holding one `pending` or one `superseded` record, a pass gap that
 * blocks but carries no record id, and the arguments `verifyOpenFindings` needs
 * — its stub judge records every spawn, so a test can see that none was asked.
 */
const setupLifecycleRecord = async ({ status }: { status: typeof GradeFindingStatus.Pending | typeof GradeFindingStatus.Superseded }) => {
	const observations: GapObservation[] = [
		{
			phase: 'phase1-contracts.md',
			lens: GapCheckLens.Decisions,
			area: GapArea.OmittedDecision,
			gap: 'the retry budget is never stated',
			decision: 'state the retry budget',
			options: ['one retry', 'none'],
		},
		{
			phase: 'phase2-grading.md',
			lens: GapCheckLens.Wiring,
			area: GapArea.PhaseSeamMismatch,
			gap: 'the grading phase retries a judge the contracts phase never budgets for',
			decision: 'state the retry budget once for both phases',
			options: [],
		},
	];
	const pending = status === GradeFindingStatus.Pending;
	const record: GradeFindingRecord = {
		id: 'f2',
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'the retry budget is never stated',
		decision: 'state the retry budget',
		options: ['one retry', 'none'],
		observations,
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status,
		disposition: pending ? undefined : GapOutcome.NeedsAHuman,
		unjudgedReason: pending ? 'the judge fan-out stopped before this finding was judged' : undefined,
		supersededBy: pending ? undefined : 'f1',
		resolutions: [],
		reopened: [],
	};
	const memory: GradeMemory = {
		planName: 'lo-133-duplicate-grading-reports-cause',
		findings: [record],
		nextFindingNumber: 3,
		updatedAt: '2026-09-07T00:00:00.000Z',
	};
	const gaps: GradedGap[] = [
		{
			area: GapArea.OmittedDecision,
			gap: 'an unrelated question a reader raised this pass',
			decision: 'settle the unrelated question',
			options: [],
			observations: [],
			phase: 'phase2-grading.md',
			lens: GapCheckLens.Decisions,
			outcome: GapOutcome.NeedsAHuman,
		},
	];
	const cwd = await freshCwd();
	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text: 'not json at all', exitCode: 1 };
		},
	};
	const verifyParams = {
		cwd,
		driver,
		workspaceDir: cwd,
		files: [
			{ path: join(cwd, 'phase1-contracts.md'), text: '# Phase 1\n' },
			{ path: join(cwd, 'phase2-grading.md'), text: '# Phase 2\n' },
		],
		memory,
		at: '2026-09-11T00:00:00.000Z',
	};

	return { memory, gaps, record, observations, invocations, verifyParams };
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

	test('an open grouped record is surfaced carrying every observation and its shared defect', () => {
		const { memory, gaps } = setupMemory({ openIds: ['f1'], grouped: { observations: groupedObservations, sharedDefect: groupedDefect } });

		const surfaced = openFindingGaps({ memory, gaps });

		// the blocker a human reads must still name every place the defect has to be
		// fixed, and what the group was confirmed as, when no reader re-reported it
		expect(surfaced).toEqual([
			expect.objectContaining({ findingId: 'f1', outcome: GapOutcome.NeedsAHuman, observations: groupedObservations, sharedDefect: groupedDefect }),
		]);
	});

	test('leaves a superseded record out of the blockers and out of re-verification', async () => {
		const { memory, gaps, record, invocations, verifyParams } = await setupLifecycleRecord({ status: GradeFindingStatus.Superseded });

		const surfaced = openFindingGaps({ memory, gaps });
		const verified = await verifyOpenFindings(verifyParams);

		// its obligation moved to the record named in supersededBy, so it neither
		// blocks here nor costs a recheck judge, and it comes back exactly as it went in
		expect(surfaced).toStrictEqual([]);
		expect(invocations).toHaveLength(0);
		expect(verified.memory.findings).toStrictEqual([record]);
	});

	test('surfaces a pending record as a blocking unjudged gap', async () => {
		const { memory, gaps, observations } = await setupLifecycleRecord({ status: GradeFindingStatus.Pending });

		const surfaced = openFindingGaps({ memory, gaps });
		const blocking = surfaced.map((gap) => isBlockingGap({ gap }));

		// a blocking pass gap with no record id must not hide the pending record,
		// and the record keeps blocking through the one shared predicate
		expect(surfaced).toEqual([
			expect.objectContaining({
				findingId: 'f2',
				outcome: GapOutcome.Unjudged,
				phase: 'phase1-contracts.md',
				area: GapArea.OmittedDecision,
				gap: 'the retry budget is never stated',
				decision: 'state the retry budget',
				options: ['one retry', 'none'],
				observations,
				unjudgedReason: 'the judge fan-out stopped before this finding was judged',
			}),
		]);
		expect(blocking).toStrictEqual([true]);
	});
});
