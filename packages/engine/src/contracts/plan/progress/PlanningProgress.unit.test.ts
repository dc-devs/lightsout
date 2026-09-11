import { describe, expect, test } from '@jest/globals';
import { PlanningProgress, PlanningStep } from '#src/contracts/index.ts';

const setupRecords = () => {
	const finishedEntry = {
		step: 'verify-facts',
		status: 'passed',
		attempts: 2,
		pid: 4242,
		startedAt: '2026-09-10T09:00:00.000Z',
		finishedAt: '2026-09-10T09:00:30.000Z',
		durationMs: 30_000,
	};
	const runningEntry = {
		step: 'draft',
		status: 'running',
		attempts: 1,
		pid: 4243,
		startedAt: '2026-09-10T09:01:00.000Z',
	};
	const record = {
		name: 'queue-swim-lanes',
		updatedAt: '2026-09-10T09:01:00.000Z',
		steps: [finishedEntry, runningEntry],
	};
	const recordWithUnknownStep = { ...record, steps: [{ ...runningEntry, step: 'lint' }] };
	const recordWithZeroAttempts = { ...record, steps: [{ ...finishedEntry, attempts: 0 }] };

	return { record, recordWithUnknownStep, recordWithZeroAttempts };
};

describe('PlanningProgress', () => {
	test('accepts a well-formed planning record and rejects an unknown step id or zero attempts', () => {
		const { record, recordWithUnknownStep, recordWithZeroAttempts } = setupRecords();

		const accepted = PlanningProgress.safeParse(record);
		const unknownStep = PlanningProgress.safeParse(recordWithUnknownStep);
		const zeroAttempts = PlanningProgress.safeParse(recordWithZeroAttempts);

		expect(accepted.data).toStrictEqual({
			name: 'queue-swim-lanes',
			updatedAt: '2026-09-10T09:01:00.000Z',
			steps: [
				{
					step: 'verify-facts',
					status: 'passed',
					attempts: 2,
					pid: 4242,
					startedAt: '2026-09-10T09:00:00.000Z',
					finishedAt: '2026-09-10T09:00:30.000Z',
					durationMs: 30_000,
				},
				{
					step: 'draft',
					status: 'running',
					attempts: 1,
					pid: 4243,
					startedAt: '2026-09-10T09:01:00.000Z',
				},
			],
		});
		expect(unknownStep.success).toBe(false);
		expect(zeroAttempts.success).toBe(false);
	});
});

describe('PlanningStep', () => {
	test('lists the five planning steps in the order the block draws them', () => {
		const steps = Object.values(PlanningStep);

		expect(steps).toStrictEqual(['verify-facts', 'draft', 'dedup', 'grade', 'publish']);
	});
});
