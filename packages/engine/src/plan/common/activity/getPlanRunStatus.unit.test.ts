import { describe, expect, test } from '@jest/globals';
import type { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { getPlanRunStatus } from '#src/plan/common/activity/getPlanRunStatus.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';

describe('getPlanRunStatus', () => {
	test.each<{ status: PlanRunStatus; closes: RunStatus }>([
		{ status: PlanRunStatus.Complete, closes: 'passed' },
		// the wall is resumable, so the row a human reads says parked rather than
		// sending them to diagnose a run that only has to be re-run later
		{ status: PlanRunStatus.PausedRateLimit, closes: 'paused-rate-limit' },
		{ status: PlanRunStatus.Failed, closes: 'failed' },
		// a plan that did not survive its own checks is a level that did not pass:
		// the two draft-only ends are resting states of the command, and neither
		// is something the report may call a clean run
		{ status: PlanRunStatus.FactsError, closes: 'failed' },
		{ status: PlanRunStatus.StructuralIssues, closes: 'failed' },
	])('a $status plan run closes its level as $closes', ({ status, closes }) => {
		const closed = getPlanRunStatus({ status });

		expect(closed).toBe(closes);
	});
});
