import { describe, expect, test } from '@jest/globals';
import { ShippingProgress, ShippingStepId } from '#src/contracts/index.ts';

const setupRecords = () => {
	const record = {
		branch: 'feature/lo-7',
		attempt: 1,
		maxAttempts: 3,
		pid: 4321,
		startedAt: '2026-09-11T09:00:00.000Z',
		updatedAt: '2026-09-11T09:05:00.000Z',
		steps: [
			{ id: 'integrate', status: 'passed', startedAt: '2026-09-11T09:00:00.000Z', durationMs: 12000 },
			{ id: 'push', status: 'passed', startedAt: '2026-09-11T09:00:12.000Z', durationMs: 3000 },
			{ id: 'pull-request', status: 'running', startedAt: '2026-09-11T09:00:15.000Z' },
			{ id: 'checks', status: 'pending' },
			{ id: 'merge', status: 'pending' },
			{ id: 'sync', status: 'pending' },
		],
	};
	const recordWithUnknownStep = {
		...record,
		steps: record.steps.map((step) => (step.id === 'merge' ? { ...step, id: 'deploy' } : step)),
	};
	const recordWithUnknownStatus = {
		...record,
		steps: record.steps.map((step) => (step.id === 'checks' ? { ...step, status: 'skipped' } : step)),
	};

	return { records: [record, recordWithUnknownStep, recordWithUnknownStatus] };
};

describe('ShippingProgress', () => {
	test('accepts a six-step record and rejects a step id or a status outside its named constants', () => {
		const { records } = setupRecords();

		const accepted = records.map((record) => ShippingProgress.safeParse(record).success);

		expect(accepted).toStrictEqual([true, false, false]);
	});
});

describe('ShippingStepId', () => {
	test('names the six ship steps in the order the block draws them', () => {
		const steps = Object.values(ShippingStepId);

		expect(steps).toStrictEqual(['integrate', 'push', 'pull-request', 'checks', 'merge', 'sync']);
	});
});
