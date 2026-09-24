import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import { nameWaveWorkOrders } from '#src/queue/nameWaveWorkOrders.ts';
import type { WorkOrderListing } from '#src/workOrder/index.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

// Mocked Imports
// -------------------------
// Reading a record and writing one are the work order module's own job, each
// with its own tests. What this file owns is the policy: which tickets reach
// the one writer of a name, which names the wave carries onward, and what
// happens to a ticket that could not be named.
interface CreateWorkOrderParams {
	cwd: string;
	ticketRef?: string;
	title?: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	driver?: Driver;
	mode?: WorkOrderMode;
	onProgress?: (message: string) => void;
}

type CreateWorkOrderResult = { name: string; branch: string; record: WorkOrderState } | { error: string };

const mockFindWorkOrderByTicketRef = jest.fn<(params: { cwd: string; ticketRef: string }) => Promise<WorkOrderListing | undefined>>();
const mockCreateWorkOrder = jest.fn<(params: CreateWorkOrderParams) => Promise<CreateWorkOrderResult>>();

jest.mock('#src/workOrder/index.ts', () => ({
	findWorkOrderByTicketRef: (params: { cwd: string; ticketRef: string }) => mockFindWorkOrderByTicketRef(params),
	createWorkOrder: (params: CreateWorkOrderParams) => mockCreateWorkOrder(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/** A record already on this machine, in the smallest shape the state contract accepts. */
const recordOf = ({ name, branch = name, ticketRef }: { name: string; branch?: string; ticketRef: string }): WorkOrderState => ({
	schemaVersion: 1,
	name,
	branch,
	ticketRef,
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history: [],
});

/**
 * A wave whose tickets are named against the records this machine already
 * holds: `existing` maps a ticket reference to the work order that carries it,
 * and `creation` is what the one writer of a name answers for every ticket that
 * has none.
 */
const setupNaming = ({
	numbers,
	existing = {},
	creation = { name: 'lo-71-new-work', branch: 'lo-71-new-work' },
}: {
	numbers: number[];
	existing?: Record<string, { name: string; branch?: string }>;
	creation?: { name: string; branch: string } | { error: string };
}) => {
	const progress: string[] = [];
	const driver = createUncalledDriver({ reason: 'the summariser is spawned by createWorkOrder, which this file mocks' });

	mockFindWorkOrderByTicketRef.mockImplementation(({ ticketRef }) => {
		const held = existing[ticketRef];

		return Promise.resolve(held === undefined ? undefined : { name: held.name, record: recordOf({ ...held, ticketRef }) });
	});
	mockCreateWorkOrder.mockImplementation(({ ticketRef }) =>
		Promise.resolve(
			'error' in creation ? creation : { name: creation.name, branch: creation.branch, record: recordOf({ ...creation, ticketRef: ticketRef ?? '' }) },
		),
	);

	const tickets = numbers.map((number) => queueTicketFixture({ number }));

	const name = () =>
		nameWaveWorkOrders({
			cwd: '/repo',
			config,
			env: {},
			driver,
			tickets,
			onProgress: (message) => progress.push(message),
		});

	return { name, tickets, driver, progress };
};

/**
 * A wave whose tickets each name the worker the queue selected for them; a
 * ticket listed in `existing` already has a record, and every other ticket is
 * created under a label drawn from its own reference.
 */
const setupWorkerNaming = ({ workers, existing = {} }: { workers: Record<number, QueueWorker>; existing?: Record<string, { name: string }> }) => {
	const driver = createUncalledDriver({ reason: 'the summariser is spawned by createWorkOrder, which this file mocks' });

	mockFindWorkOrderByTicketRef.mockImplementation(({ ticketRef }) => {
		const held = existing[ticketRef];

		return Promise.resolve(held === undefined ? undefined : { name: held.name, record: recordOf({ ...held, ticketRef }) });
	});
	mockCreateWorkOrder.mockImplementation(({ ticketRef = '' }) => {
		const name = `${ticketRef.toLowerCase()}-new-work`;

		return Promise.resolve({ name, branch: name, record: recordOf({ name, ticketRef }) });
	});

	const tickets = Object.entries(workers).map(([number, worker]) => queueTicketFixture({ number: Number(number), worker }));

	const name = () => nameWaveWorkOrders({ cwd: '/repo', config, env: {}, driver, tickets });

	return { name };
};

describe('nameWaveWorkOrders', () => {
	test('reuses an existing work order and creates one only for a ticket that has none', async () => {
		const { name, tickets, driver } = setupNaming({
			numbers: [70, 71],
			existing: { 'LO-70': { name: 'lo-70-already-named' } },
			creation: { name: 'lo-71-new-work', branch: 'lo-71-new-work' },
		});

		const wave = await name();

		expect(wave).toEqual({
			named: [
				{ ticket: tickets[0], name: 'lo-70-already-named', branch: 'lo-70-already-named' },
				{ ticket: tickets[1], name: 'lo-71-new-work', branch: 'lo-71-new-work' },
			],
			leftBehind: [],
		});
		expect(mockCreateWorkOrder).toHaveBeenCalledTimes(1);
		expect(mockCreateWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo', ticketRef: 'LO-71', driver }));
	});

	test('leaves a ticket behind when the one writer of a name refuses to name it', async () => {
		const { name } = setupNaming({
			numbers: [71],
			creation: { error: 'lo-71-new-work already names a work order — pass --title <words> to name this one differently' },
		});

		const wave = await name();

		expect(wave.named).toEqual([]);
		expect(wave.leftBehind).toEqual([
			expect.objectContaining({ identifier: 'LO-71', reason: expect.stringContaining('already names a work order') as unknown as string }),
		]);
	});

	test('carries the label and the branch as the record stores them', async () => {
		const { name, tickets } = setupNaming({
			numbers: [72],
			existing: { 'LO-72': { name: 'lo-72-beta', branch: 'feature/lo-72-beta' } },
		});

		const wave = await name();

		expect(wave.named).toEqual([{ ticket: tickets[0], name: 'lo-72-beta', branch: 'feature/lo-72-beta' }]);
	});

	test('creates the record of a ticket built from its body in single-plan mode and leaves an auto-plan ticket on the repository default', async () => {
		const { name } = setupWorkerNaming({
			workers: { 70: 'direct', 71: 'plan', 72: 'auto-plan', 73: 'direct' },
			existing: { 'LO-73': { name: 'lo-73-already-named' } },
		});

		await name();

		const creations = mockCreateWorkOrder.mock.calls.map(([params]) => ({ ticketRef: params.ticketRef, mode: params.mode }));
		expect(creations).toEqual([
			{ ticketRef: 'LO-70', mode: 'single-plan' },
			{ ticketRef: 'LO-71', mode: 'single-plan' },
			{ ticketRef: 'LO-72', mode: undefined },
		]);
	});
});
