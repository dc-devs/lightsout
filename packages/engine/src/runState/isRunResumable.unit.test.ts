import { expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { isRunResumable } from '#src/runState/index.ts';

test('resumable is exactly the states a `resume --run` has work in', () => {
	const dead = Object.values(RunStatus).filter((status) => isRunResumable({ status, live: false }));

	// running with nothing behind it is a crash leftover — resumable, not lost
	expect(dead).toStrictEqual([RunStatus.Running, RunStatus.Failed, RunStatus.PausedRateLimit, RunStatus.PausedBudget]);
});

test('a run with a live process behind it is resumable only where it had already stopped', () => {
	const live = Object.values(RunStatus).filter((status) => isRunResumable({ status, live: true }));

	// `running` drops out: something is already doing the work
	expect(live).toStrictEqual([RunStatus.Failed, RunStatus.PausedRateLimit, RunStatus.PausedBudget]);
});

test('escalated is excluded: it is waiting on a human decision, not on a resume', () => {
	expect(isRunResumable({ status: RunStatus.Escalated, live: false })).toBe(false);
	// and a run that has not started, or has passed, has nothing to resume into
	expect(isRunResumable({ status: RunStatus.Pending, live: false })).toBe(false);
	expect(isRunResumable({ status: RunStatus.Passed, live: false })).toBe(false);
});
