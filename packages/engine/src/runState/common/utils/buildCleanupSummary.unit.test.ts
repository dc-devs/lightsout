import { describe, expect, test } from '@jest/globals';
import { CleanupEndReason, type PhaseReport, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { buildCleanupSummary } from '#src/runState/common/utils/buildCleanupSummary.ts';
import { countableFindings } from '#tests/helpers/countableFindings.ts';

/**
 * A refactor step record carrying a cleanup report. Every list is a different
 * length, so a helper that read the wrong one reports the wrong number.
 */
const setupCleanupStep = ({ endReason }: { endReason?: CleanupEndReason } = {}): { step: StepRecord } => ({
	step: {
		id: 'refactor',
		status: RunStatus.Passed,
		attempts: 4,
		report: {
			roundsUsed: 3,
			...(endReason === undefined ? {} : { endReason }),
			remaining: countableFindings({ rule: 'size-file', count: 2 }),
			inherited: countableFindings({ rule: 'crowded-folder', count: 3 }),
			uncertain: countableFindings({ rule: 'star-re-export', count: 1 }),
			failures: ['refactor executor timed out after 20 minutes'],
			initialReview: countableFindings({ rule: 'naming', count: 7 }),
			finalReview: countableFindings({ rule: 'size-function', count: 5 }),
		},
	},
});

/**
 * The two ways a step can carry no cleanup record — no report at all, and a
 * coordinator's own phase report — arranged together, because they are the two
 * halves of one fact rather than two cases.
 */
const setupNonCleanupSteps = (): { unreached: StepRecord; coordinator: StepRecord } => ({
	unreached: { id: 'phase-1', status: RunStatus.Passed, attempts: 1 },
	coordinator: { id: 'phase-2', status: RunStatus.Passed, attempts: 1, report: { runId: 'run-child' } satisfies PhaseReport },
});

describe('buildCleanupSummary', () => {
	test('buildCleanupSummary: a step whose report parses answers the rounds, the end reason and a count for every recorded list', () => {
		const { step } = setupCleanupStep({ endReason: CleanupEndReason.BudgetExhausted });

		const summary = buildCleanupSummary({ step });

		// carried is the inherited debt plus the findings whose provenance could
		// not be established: 3 + 1, and the review count is the FINAL review's 5
		// rather than the initial review's 7
		expect(summary).toEqual({
			rounds: 3,
			endReason: 'budget-exhausted',
			remainingFindings: 2,
			carriedFindings: 4,
			reviewFindings: 5,
			failures: 1,
		});
	});

	test('buildCleanupSummary: a step carrying no cleanup report answers undefined rather than a zeroed summary', () => {
		const { unreached, coordinator } = setupNonCleanupSteps();

		const unreachedSummary = buildCleanupSummary({ step: unreached });
		const coordinatorSummary = buildCleanupSummary({ step: coordinator });

		// a zeroed summary here would print a cleanup line claiming a pass that
		// never ran, on a step that is not the cleanup step at all
		expect(unreachedSummary).toBeUndefined();
		expect(coordinatorSummary).toBeUndefined();
	});

	test('buildCleanupSummary: a mid-loop record answers its rounds with no end reason', () => {
		const { step } = setupCleanupStep();

		const summary = buildCleanupSummary({ step });

		// the step writes the record before every invocation, so a parked run
		// reports what it spent without claiming cleanup ended
		expect(summary).toEqual({
			rounds: 3,
			endReason: undefined,
			remainingFindings: 2,
			carriedFindings: 4,
			reviewFindings: 5,
			failures: 1,
		});
	});
});
