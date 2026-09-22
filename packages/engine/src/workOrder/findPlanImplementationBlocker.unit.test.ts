import { describe, expect, test } from '@jest/globals';
import { PlanProgress, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import { findPlanImplementationBlocker } from '#src/workOrder/index.ts';

/**
 * One plan of a work order's state, carrying only what the order rule reads: its
 * id, how far it got, the run it recorded, and the exclusion that takes it out
 * of the order.
 */
const planWith = ({
	id,
	progress,
	runId,
	excludedFor,
}: {
	id: string;
	progress: PlanProgress;
	/** The run recorded against this plan, which a refusal names when there is one to resume. */
	runId?: string;
	/** The recorded reason, whose presence is what makes the plan an excluded one. */
	excludedFor?: string;
}): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-03-01T00:00:00.000Z',
	...(runId === undefined ? {} : { implementation: { runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' } }),
	...(excludedFor === undefined ? {} : { exclusion: { at: '2026-03-03T09:00:00.000Z', reason: excludedFor, implementationRemoved: false } }),
});

/** A work order state on branch `lo-140-multi`, in whichever mode and with whichever plans the test needs. */
const setupTicket = ({ mode = WorkOrderMode.MultiplePlan, plans = [] }: { mode?: WorkOrderMode; plans?: WorkOrderPlan[] } = {}) => {
	const record: WorkOrderState = {
		schemaVersion: 1,
		name: 'lo-140-multi',
		ticketRef: 'LO-140',
		branch: 'lo-140-multi',
		mode,
		plans,
		history: [],
	};

	return { record };
};

/**
 * A work order whose label and git branch are different strings: the folder is
 * labelled `lo-141-prefixed`, while its plans implement on the prefixed branch
 * `feature/lo-141-prefixed`. Every sentence this file reads names the label.
 */
const setupPrefixedBranchWorkOrder = () => {
	const record: WorkOrderState = {
		schemaVersion: 1,
		ticketRef: 'LO-141',
		name: 'lo-141-prefixed',
		branch: 'feature/lo-141-prefixed',
		mode: WorkOrderMode.MultiplePlan,
		plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-addressing', progress: PlanProgress.Ready })],
		history: [],
	};

	return { record };
};

describe('findPlanImplementationBlocker', () => {
	test.each([
		{ progress: PlanProgress.Planning },
		{ progress: PlanProgress.Ready },
		{ progress: PlanProgress.Implementing },
		{ progress: PlanProgress.Failed },
	])('allows plan 001 of a single-plan ticket in any progress short of implemented', ({ progress }) => {
		const { record } = setupTicket({ mode: WorkOrderMode.SinglePlan, plans: [planWith({ id: '001-record', progress })] });

		const blocker = findPlanImplementationBlocker({ record, planId: '001-record' });

		expect(blocker).toBeUndefined();
	});

	test('allows a plan whose every lower plan is implemented or excluded', () => {
		const { record } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Implemented }),
				planWith({ id: '002-addressing', progress: PlanProgress.Failed, runId: 'run-2b7e', excludedFor: 'replaced by 003' }),
				planWith({ id: '003-queue-order', progress: PlanProgress.Ready }),
			],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '003-queue-order' });

		expect(blocker).toBeUndefined();
	});

	test('refuses a plan the record does not hold and names work-order show', () => {
		const { record } = setupTicket({ plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented })] });

		const blocker = findPlanImplementationBlocker({ record, planId: '004-nothing-here' });

		expect(blocker).toContain('004-nothing-here');
		expect(blocker).toContain('lightsout work-order show');
	});

	test('refuses an excluded plan and names its reason and work-order add-plan', () => {
		const { record } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Implemented }),
				planWith({ id: '002-addressing', progress: PlanProgress.Ready, excludedFor: 'switched to single-plan mode' }),
			],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '002-addressing' });

		expect(blocker).toContain('002-addressing');
		expect(blocker).toContain('switched to single-plan mode');
		expect(blocker).toContain('lightsout work-order add-plan');
	});

	test('refuses a plan other than 001 in single-plan mode and names the mode switch', () => {
		const { record } = setupTicket({
			mode: WorkOrderMode.SinglePlan,
			plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented }), planWith({ id: '002-addressing', progress: PlanProgress.Ready })],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '002-addressing' });

		expect(blocker).toContain('002-addressing');
		expect(blocker).toContain('lightsout work-order mode');
		expect(blocker).toContain('--set multiple-plan');
	});

	test('refuses an implemented plan and names work-order add-plan for follow-up work', () => {
		const { record } = setupTicket({ plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented })] });

		const blocker = findPlanImplementationBlocker({ record, planId: '001-record' });

		expect(blocker).toContain('001-record');
		expect(blocker).toContain('lightsout work-order add-plan');
	});

	test.each([
		{
			progress: PlanProgress.Failed,
			runId: 'run-5c1a',
			expected: ['001-record', 'lightsout resume --run', 'run-5c1a', 'lightsout work-order exclude-plan'],
		},
		{
			progress: PlanProgress.Ready,
			runId: undefined,
			expected: ['001-record', 'lightsout implement --plan', '.lightsout/work-orders/lo-140-multi/plans/001-record', 'lightsout work-order exclude-plan'],
		},
	])('refuses behind the lowest lower plan that is not implemented and names how to resolve it', ({ progress, runId, expected }) => {
		const { record } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress, runId }),
				planWith({ id: '002-addressing', progress: PlanProgress.Planning }),
				planWith({ id: '003-queue-order', progress: PlanProgress.Ready }),
			],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '003-queue-order' });

		expect(blocker).toContain(expected[0]);
		expect(blocker).toContain(expected[1]);
		expect(blocker).toContain(expected[2]);
		expect(blocker).toContain(expected[3]);
		expect(blocker).not.toContain('unfinished');
	});

	test('findPlanImplementationBlocker: every blocker that names a command spells the work-order command word', () => {
		const { record } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Implemented }),
				planWith({ id: '002-addressing', progress: PlanProgress.Ready, excludedFor: 'switched to single-plan mode' }),
			],
		});
		const { record: singlePlanRecord } = setupTicket({
			mode: WorkOrderMode.SinglePlan,
			plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented }), planWith({ id: '002-addressing', progress: PlanProgress.Ready })],
		});
		const { record: lowerPlanRecord } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Failed, runId: 'run-5c1a' }),
				planWith({ id: '002-addressing', progress: PlanProgress.Ready }),
			],
		});

		const unheldPlan = findPlanImplementationBlocker({ record, planId: '004-nothing-here' });
		const excludedPlan = findPlanImplementationBlocker({ record, planId: '002-addressing' });
		const outOfModePlan = findPlanImplementationBlocker({ record: singlePlanRecord, planId: '002-addressing' });
		const implementedPlan = findPlanImplementationBlocker({ record, planId: '001-record' });
		const behindLowerPlan = findPlanImplementationBlocker({ record: lowerPlanRecord, planId: '002-addressing' });

		expect(unheldPlan).toContain('lightsout work-order show --name lo-140-multi');
		expect(excludedPlan).toContain('lightsout work-order add-plan --name lo-140-multi');
		expect(outOfModePlan).toContain('lightsout work-order mode --name lo-140-multi --set multiple-plan');
		expect(implementedPlan).toContain('lightsout work-order add-plan --name lo-140-multi');
		expect(behindLowerPlan).toContain('lightsout work-order exclude-plan --name lo-140-multi --plan 001-record');
		expect([unheldPlan, excludedPlan, outOfModePlan, implementedPlan, behindLowerPlan].join('\n')).not.toContain('lightsout ticket ');
	});

	test('names the work order by its label when the branch carries a prefix', () => {
		const { record } = setupPrefixedBranchWorkOrder();

		const blocker = findPlanImplementationBlocker({ record, planId: '002-addressing' });

		expect(blocker).toContain('work order lo-141-prefixed');
		expect(blocker).toContain('.lightsout/work-orders/lo-141-prefixed/plans/001-record');
		expect(blocker).toContain('lightsout work-order exclude-plan --name lo-141-prefixed --plan 001-record');
		expect(blocker).not.toContain('feature/');
	});
});
