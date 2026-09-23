import { describe, expect, test } from '@jest/globals';
import { WorkOrderEventKind, WorkOrderMode } from '#src/contracts/index.ts';

describe('WorkOrderMode', () => {
	test('WorkOrderMode and WorkOrderEventKind: stored values are unchanged by the rename', () => {
		const modeValues = Object.values(WorkOrderMode);
		const eventKindValues = Object.values(WorkOrderEventKind);

		expect(WorkOrderMode).toStrictEqual({
			SinglePlan: 'single-plan',
			MultiplePlan: 'multiple-plan',
		});
		expect(modeValues).toStrictEqual(['single-plan', 'multiple-plan']);
		expect(WorkOrderEventKind).toStrictEqual({
			PlanAdded: 'plan-added',
			PlanAdopted: 'plan-adopted',
			PlanRetitled: 'plan-retitled',
			PlanExcluded: 'plan-excluded',
			ModeChanged: 'mode-changed',
			ShipRequested: 'ship-requested',
			ShipRequestWithdrawn: 'ship-request-withdrawn',
			Shipped: 'shipped',
		});
		expect(eventKindValues).toStrictEqual([
			'plan-added',
			'plan-adopted',
			'plan-retitled',
			'plan-excluded',
			'mode-changed',
			'ship-requested',
			'ship-request-withdrawn',
			'shipped',
		]);
	});
});
