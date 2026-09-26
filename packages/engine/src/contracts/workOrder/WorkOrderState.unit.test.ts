import { describe, expect, test } from '@jest/globals';
import { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';

const setupWorkOrderState = () => {
	const firstPlan = {
		id: '001-work-order-state',
		title: 'Work order state',
		progress: 'implemented',
		createdAt: '2026-09-01T09:00:00.000Z',
		implementation: {
			runId: 'run-implement-001',
			startedAt: '2026-09-02T09:00:00.000Z',
			startCommit: '9c4e2f7a1b3d5e6f8091a2b3c4d5e6f708192a3b',
			finishedAt: '2026-09-02T11:30:00.000Z',
			snapshot: [{ name: 'plan.md', sha256: '5f0c1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7' }],
		},
		publishedMarker: 'c1d2e3f405162738495a6b7c8d9e0f1122334455667788990aabbccddeeff001',
	};
	const secondPlan = {
		id: '002-plan-addressing',
		title: 'Plan addressing',
		progress: 'planning',
		createdAt: '2026-09-03T09:00:00.000Z',
	};
	const state = {
		schemaVersion: 1,
		name: 'lo-158-a-ticket-s-branch-name-has-no-single',
		ticketRef: 'LO-158',
		branch: 'lo-158-a-ticket-s-branch-name-has-no-single',
		mode: 'multiple-plan',
		plans: [firstPlan, secondPlan],
		shipRequest: { planIds: ['001-work-order-state'], requestedAt: '2026-09-05T09:00:00.000Z' },
		history: [{ at: '2026-09-01T09:00:00.000Z', kind: 'plan-added', detail: 'added 001-work-order-state' }],
	};

	return { state, firstPlan, secondPlan };
};

const setupFullWorkOrderState = () => {
	const implementedPlan = {
		id: '001-ticket-record',
		title: 'Ticket record',
		progress: 'implemented',
		createdAt: '2026-09-01T09:00:00.000Z',
		implementation: {
			runId: 'run-implement-001',
			startedAt: '2026-09-02T09:00:00.000Z',
			startCommit: '9c4e2f7a1b3d5e6f8091a2b3c4d5e6f708192a3b',
			finishedAt: '2026-09-02T11:30:00.000Z',
			snapshot: [{ name: 'plan.md', sha256: '5f0c1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7' }],
		},
		publishedMarker: 'c1d2e3f405162738495a6b7c8d9e0f1122334455667788990aabbccddeeff001',
	};
	const excludedPlan = {
		id: '002-plan-addressing',
		title: 'Plan addressing',
		progress: 'failed',
		createdAt: '2026-09-03T09:00:00.000Z',
		exclusion: {
			at: '2026-09-04T09:00:00.000Z',
			reason: 'switched to single-plan mode',
			implementationRemoved: true,
			verifiedCommit: '77aa1122bb3344cc5566dd7788ee99ff00112233',
		},
	};
	const record = {
		schemaVersion: 1,
		name: 'lo-140-support-multiple-plans-per-ticket-on-one-branch',
		ticketRef: 'LO-140',
		branch: 'lo-140-support-multiple-plans-per-ticket-on-one-branch',
		mode: 'multiple-plan',
		plans: [implementedPlan, excludedPlan],
		shipRequest: { planIds: ['001-ticket-record'], requestedAt: '2026-09-05T09:00:00.000Z' },
		shipped: {
			at: '2026-09-06T09:00:00.000Z',
			planIds: ['001-ticket-record'],
			mergeCommit: '0123456789abcdef0123456789abcdef01234567',
		},
		history: [
			{ at: '2026-09-01T09:00:00.000Z', kind: 'plan-added', detail: 'added 001-ticket-record' },
			{ at: '2026-09-01T09:05:00.000Z', kind: 'plan-adopted', detail: 'adopted the legacy folder as 001-ticket-record' },
			{ at: '2026-09-01T09:10:00.000Z', kind: 'plan-retitled', detail: 'retitled 001-ticket-record to Ticket record' },
			{ at: '2026-09-04T09:00:00.000Z', kind: 'plan-excluded', detail: 'excluded 002-plan-addressing' },
			{ at: '2026-09-01T09:15:00.000Z', kind: 'mode-changed', detail: 'mode changed to multiple-plan' },
			{ at: '2026-09-05T09:00:00.000Z', kind: 'ship-requested', detail: 'ship requested for 001-ticket-record' },
			{ at: '2026-09-05T09:30:00.000Z', kind: 'ship-request-withdrawn', detail: 'withdrawn when 002-plan-addressing was added' },
			{ at: '2026-09-06T09:00:00.000Z', kind: 'shipped', detail: 'merged as 0123456789abcdef0123456789abcdef01234567' },
		],
	};

	return { record, implementedPlan, excludedPlan };
};

const setupTrackerFreeWorkOrderState = () => {
	const plan = {
		id: '001-rename-the-folder',
		title: 'Rename the folder',
		progress: 'planning',
		createdAt: '2026-09-10T09:00:00.000Z',
	};
	const state = {
		schemaVersion: 1,
		name: 'rename-the-folder',
		branch: 'rename-the-folder',
		mode: 'single-plan',
		plans: [plan],
		history: [{ at: '2026-09-10T09:00:00.000Z', kind: 'plan-added', detail: 'added 001-rename-the-folder' }],
	};

	return { state, plan };
};

const setupPlanlessWorkOrderState = () => {
	const state = {
		schemaVersion: 1,
		name: 'lo-166-ship-tickets-without-plan',
		ticketRef: 'LO-166',
		branch: 'lo-166-ship-tickets-without-plan',
		mode: 'single-plan',
		plans: [],
		history: [{ at: '2026-09-20T09:00:00.000Z', kind: 'mode-changed', detail: 'mode set to single-plan' }],
	};
	const implementingBuild = {
		runId: 'run-body-build-001',
		progress: 'implementing',
		startedAt: '2026-09-21T09:00:00.000Z',
	};
	const implementedBuild = {
		runId: 'run-body-build-002',
		progress: 'implemented',
		startedAt: '2026-09-21T10:00:00.000Z',
		finishedAt: '2026-09-21T10:45:00.000Z',
	};
	const failedBuild = {
		runId: 'run-body-build-003',
		progress: 'failed',
		startedAt: '2026-09-21T11:00:00.000Z',
		finishedAt: '2026-09-21T11:20:00.000Z',
	};

	return { state, implementingBuild, implementedBuild, failedBuild };
};

describe('WorkOrderState', () => {
	test('WorkOrderState: refuses plans out of ascending number order under the renamed contract', () => {
		const { state, firstPlan, secondPlan } = setupWorkOrderState();

		const ascending = WorkOrderState.safeParse(state);
		const descending = WorkOrderState.safeParse({ ...state, plans: [secondPlan, firstPlan] });

		expect(ascending.success).toBe(true);
		expect(descending.success).toBe(false);
		expect(descending.error?.message ?? '').toContain('001-work-order-state');
		expect(descending.error?.message ?? '').toContain('002-plan-addressing');
	});

	test('WorkOrderState: refuses a ship request naming a plan the record does not hold', () => {
		const { state } = setupWorkOrderState();

		const unheldPlan = WorkOrderState.safeParse({
			...state,
			shipRequest: { planIds: ['003-publish-and-restore'], requestedAt: '2026-09-05T09:00:00.000Z' },
		});
		const heldPlans = WorkOrderState.safeParse({
			...state,
			shipRequest: {
				planIds: ['001-work-order-state', '002-plan-addressing'],
				requestedAt: '2026-09-05T09:00:00.000Z',
			},
		});

		expect(unheldPlan.success).toBe(false);
		expect(unheldPlan.error?.message ?? '').toContain('003-publish-and-restore');
		expect(heldPlans.success).toBe(true);
	});

	test('WorkOrderState: keeps every field name, with ticketRef now optional', () => {
		const { state } = setupWorkOrderState();
		const { ticketRef: _ticketRef, ...withoutTicketRef } = state;

		const parsed = WorkOrderState.safeParse(state);
		const trackerFree = WorkOrderState.safeParse(withoutTicketRef);

		expect(parsed.success).toBe(true);
		expect(parsed.data).toStrictEqual(state);
		expect(trackerFree.success).toBe(true);
		expect(trackerFree.data).toStrictEqual(withoutTicketRef);
	});

	test('accepts a full multiple-plan record and returns it unchanged', () => {
		const { record } = setupFullWorkOrderState();

		const parsed = WorkOrderState.safeParse(record);

		expect(parsed.success).toBe(true);
		expect(parsed.data).toStrictEqual(record);
	});

	test('refuses a schema version, mode or event kind outside the declared sets', () => {
		const { record } = setupFullWorkOrderState();

		const laterSchemaVersion = WorkOrderState.safeParse({ ...record, schemaVersion: 2 });
		const unknownMode = WorkOrderState.safeParse({ ...record, mode: 'multi' });
		const unknownEventKind = WorkOrderState.safeParse({
			...record,
			history: [{ at: '2026-09-07T09:00:00.000Z', kind: 'plan-removed', detail: 'removed 002-plan-addressing' }],
		});

		expect(laterSchemaVersion.success).toBe(false);
		expect(unknownMode.success).toBe(false);
		expect(unknownEventKind.success).toBe(false);
	});

	test('refuses plans that are not in strictly ascending number order', () => {
		const { record, implementedPlan, excludedPlan } = setupFullWorkOrderState();

		const descendingPlans = WorkOrderState.safeParse({ ...record, plans: [excludedPlan, implementedPlan] });
		const repeatedNumber = WorkOrderState.safeParse({
			...record,
			plans: [implementedPlan, { ...implementedPlan, id: '001-ticket-store' }],
		});

		expect(descendingPlans.success).toBe(false);
		expect(repeatedNumber.success).toBe(false);
	});

	test('refuses a ship request naming a plan the record does not hold or naming one twice', () => {
		const { record } = setupFullWorkOrderState();

		const unknownPlan = WorkOrderState.safeParse({
			...record,
			shipRequest: { planIds: ['003-publish-and-restore'], requestedAt: '2026-09-05T09:00:00.000Z' },
		});
		const repeatedPlan = WorkOrderState.safeParse({
			...record,
			shipRequest: { planIds: ['001-ticket-record', '001-ticket-record'], requestedAt: '2026-09-05T09:00:00.000Z' },
		});

		expect(unknownPlan.success).toBe(false);
		expect(repeatedPlan.success).toBe(false);
	});

	test('refuses a key the contract does not declare at the record and plan level', () => {
		const { record, implementedPlan, excludedPlan } = setupFullWorkOrderState();

		const unknownRecordKey = WorkOrderState.safeParse({ ...record, notes: 'a key no engine writes' });
		const unknownPlanKey = WorkOrderState.safeParse({
			...record,
			plans: [{ ...implementedPlan, owner: 'implement' }, excludedPlan],
		});

		expect(unknownRecordKey.success).toBe(false);
		expect(unknownPlanKey.success).toBe(false);
	});

	test('parses a work order state with no ticketRef and refuses one with no name', () => {
		const { state } = setupTrackerFreeWorkOrderState();

		const trackerFree = WorkOrderState.safeParse(state);
		const withoutName = WorkOrderState.safeParse({ ...state, name: undefined });

		expect(trackerFree.success).toBe(true);
		expect(trackerFree.data).toStrictEqual(state);
		expect(withoutName.success).toBe(false);
	});

	test('parses a work order state whose branch carries a prefix its name does not', () => {
		const { state } = setupTrackerFreeWorkOrderState();

		const prefixedBranch = WorkOrderState.safeParse({ ...state, name: 'lo-1-x', branch: 'feature/lo-1-x' });

		expect(prefixedBranch.success).toBe(true);
		expect(prefixedBranch.data).toStrictEqual({ ...state, name: 'lo-1-x', branch: 'feature/lo-1-x' });
	});

	test('accepts a record carrying a ticket body build at each progress it may hold and returns it unchanged', () => {
		const { state, implementingBuild, implementedBuild, failedBuild } = setupPlanlessWorkOrderState();
		const implementingRecord = { ...state, ticketBodyBuild: implementingBuild };
		const implementedRecord = { ...state, ticketBodyBuild: implementedBuild };
		const failedRecord = { ...state, ticketBodyBuild: failedBuild };

		const implementing = WorkOrderState.safeParse(implementingRecord);
		const implemented = WorkOrderState.safeParse(implementedRecord);
		const failed = WorkOrderState.safeParse(failedRecord);
		const withoutBuild = WorkOrderState.safeParse(state);

		expect(implementing.success).toBe(true);
		expect(implementing.data).toStrictEqual(implementingRecord);
		expect(implemented.success).toBe(true);
		expect(implemented.data).toStrictEqual(implementedRecord);
		expect(failed.success).toBe(true);
		expect(failed.data).toStrictEqual(failedRecord);
		expect(withoutBuild.success).toBe(true);
		expect(withoutBuild.data).toStrictEqual(state);
	});

	test('refuses a ticket body build at a progress outside implementing, implemented and failed or carrying an undeclared key', () => {
		const { state, implementingBuild, implementedBuild } = setupPlanlessWorkOrderState();
		const { runId: _runId, ...withoutRunId } = implementedBuild;

		const planning = WorkOrderState.safeParse({ ...state, ticketBodyBuild: { ...implementingBuild, progress: 'planning' } });
		const ready = WorkOrderState.safeParse({ ...state, ticketBodyBuild: { ...implementingBuild, progress: 'ready' } });
		const undeclaredKey = WorkOrderState.safeParse({
			...state,
			ticketBodyBuild: { ...implementedBuild, startCommit: '9c4e2f7a1b3d5e6f8091a2b3c4d5e6f708192a3b' },
		});
		const missingRunId = WorkOrderState.safeParse({ ...state, ticketBodyBuild: withoutRunId });

		expect(planning.success).toBe(false);
		expect(ready.success).toBe(false);
		expect(undeclaredKey.success).toBe(false);
		expect(missingRunId.success).toBe(false);
	});
});
