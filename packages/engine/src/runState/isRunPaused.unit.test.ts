import { expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { isRunPaused } from '#src/runState/isRunPaused.ts';

test('isRunPaused: a ceiling stop and a rate-limit wall are pauses', () => {
	expect(isRunPaused({ status: RunStatus.PausedBudget })).toBe(true);
	expect(isRunPaused({ status: RunStatus.PausedRateLimit })).toBe(true);
});

test('isRunPaused: a run that broke, or that needs a person, is not paused', () => {
	expect(isRunPaused({ status: RunStatus.Failed })).toBe(false);
	expect(isRunPaused({ status: RunStatus.Escalated })).toBe(false);
	expect(isRunPaused({ status: RunStatus.Passed })).toBe(false);
	expect(isRunPaused({ status: RunStatus.Running })).toBe(false);
	expect(isRunPaused({ status: RunStatus.Pending })).toBe(false);
});
