import { describe, expect, test } from '@jest/globals';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { isPlanlessWorkOrder } from '#src/workOrder/isPlanlessWorkOrder.ts';

const planWith = ({ id, excluded = false }: { id: string; excluded?: boolean }): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress: 'ready',
	createdAt: '2026-01-01T00:00:00.000Z',
	...(excluded ? { exclusion: { at: '2026-01-04T00:00:00.000Z', reason: 'replaced by a follow-up plan', implementationRemoved: false } } : {}),
});

const setupRecord = ({ mode, plans }: { mode: WorkOrderState['mode']; plans: WorkOrderPlan[] }): { record: WorkOrderState } => ({
	record: {
		schemaVersion: 1,
		name: 'lo-166-ship-tickets-without-plan',
		ticketRef: 'LO-166',
		branch: 'lo-166-ship-tickets-without-plan',
		mode,
		plans,
		history: [],
	},
});

describe('isPlanlessWorkOrder', () => {
	test.each([
		{ mode: 'single-plan' as const, plans: [], expected: true },
		{ mode: 'single-plan' as const, plans: [planWith({ id: '002-queue-order', excluded: true })], expected: true },
		{ mode: 'single-plan' as const, plans: [planWith({ id: '001-record' })], expected: false },
		{ mode: 'single-plan' as const, plans: [planWith({ id: '001-record', excluded: true })], expected: false },
		{ mode: 'multiple-plan' as const, plans: [], expected: false },
	])('is true only for a single-plan record that holds no plan 001', ({ mode, plans, expected }) => {
		const { record } = setupRecord({ mode, plans });

		const planless = isPlanlessWorkOrder({ record });

		expect(planless).toBe(expected);
	});
});
