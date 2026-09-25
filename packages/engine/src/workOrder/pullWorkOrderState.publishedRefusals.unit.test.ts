import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { pullWorkOrderState } from '#src/workOrder/pullWorkOrderState.ts';
import { setupPullTicketRecord } from '#tests/helpers/setupPullTicketRecord.ts';

/**
 * What the pull refuses when the ticket's own published copy cannot be trusted.
 *
 * A sibling of `pullWorkOrderState.unit.test.ts` rather than more cases in it:
 * that file states the three-way rule the pull applies once both copies are
 * readable, while every case here is about a published copy that never gets
 * that far — unreadable, unparseable, or not a work order state at all.
 */

// Mocked Imports
// -------------------------
// Only the two reads that would touch the network are doubled. Everything else
// the pull composes — which tracker is configured, whether the folder name
// carries a ticket id, the record contract, the byte form and the lock — is the
// real thing, because the three-way rule under test is decided by those bytes.
type TrackerFailure = { error: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/getTicketAttachments.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
}));
jest.mock('#src/ticketTracker/readTicketAsset.ts', () => ({
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';

/** A record the contract accepts. `detail` is what a row varies to make two records differ. */
const recordOf = ({ branch = name, detail = 'added plan 001-record' }: { branch?: string; detail?: string } = {}): WorkOrderState => ({
	schemaVersion: 1,
	name: branch,
	ticketRef: 'LO-140',
	branch,
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail }],
});

/**
 * The shared pull arrangement, handed this file's own tracker doubles: a
 * throwaway checkout whose work order folder holds whatever the row describes.
 */
const setupPull = (params: Omit<Parameters<typeof setupPullTicketRecord>[0], 'mocks'> = {}) =>
	setupPullTicketRecord({ ...params, mocks: { getTicketAttachments: mockGetTicketAttachments, readTicketAsset: mockReadTicketAsset } });

/** The refusal an answer carries, so a row can read one sentence out of the union. */
const errorOf = (answer: { record: WorkOrderState | undefined } | { error: string }) => ('error' in answer ? answer.error : undefined);

describe('pullWorkOrderState', () => {
	test('pullWorkOrderState: refuses a published state.json that is not a valid work order state, and one that appears twice', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		// Each case is armed immediately before its own pull: the two share one
		// pair of tracker doubles, so arming both up front would leave the first
		// pull reading the second case's ticket.
		const offContract = await setupPull({ local, ticket: { publishedText: JSON.stringify({ ...recordOf(), mode: 'multi' }) } });
		const pulledOffContract = await pullWorkOrderState(offContract.params);
		const twice = await setupPull({ local, ticket: { published: recordOf({ detail: 'added plan 001-published' }), publishedTwice: true } });
		const pulledTwice = await pullWorkOrderState(twice.params);

		expect({
			offContract: errorOf(pulledOffContract),
			offContractOnDisk: readFileSync(offContract.recordPath, 'utf8'),
			twice: errorOf(pulledTwice),
			twiceOnDisk: readFileSync(twice.recordPath, 'utf8'),
		}).toEqual({
			offContract: expect.stringContaining('work-order sync'),
			offContractOnDisk: offContract.localBytes,
			twice: expect.stringContaining('state.json'),
			twiceOnDisk: twice.localBytes,
		});
	});

	test("pullWorkOrderState: refuses when the tracker cannot list the ticket's attachments", async () => {
		const { params, recordPath, localBytes } = await setupPull({
			local: recordOf({ detail: 'added plan 001-local' }),
			ticket: { listFailure: 'the tracker API answered 503' },
		});

		const pulled = await pullWorkOrderState(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8') }).toEqual({
			error: expect.stringContaining('the tracker API answered 503'),
			onDisk: localBytes,
		});
	});

	test('pullWorkOrderState: refuses when the published state.json cannot be read', async () => {
		const { params, recordPath, localBytes } = await setupPull({
			local: recordOf({ detail: 'added plan 001-local' }),
			ticket: { published: recordOf({ detail: 'added plan 001-published' }), assetFailure: 'the upload store answered 404' },
		});

		const pulled = await pullWorkOrderState(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8') }).toEqual({
			error: expect.stringContaining('the upload store answered 404'),
			onDisk: localBytes,
		});
	});

	test('pullWorkOrderState: refuses a published state.json that is not JSON at all', async () => {
		const { params, recordPath, localBytes } = await setupPull({
			local: recordOf({ detail: 'added plan 001-local' }),
			ticket: { publishedText: '{ "branch": ' },
		});

		const pulled = await pullWorkOrderState(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8') }).toEqual({
			error: expect.stringContaining('is not valid JSON'),
			onDisk: localBytes,
		});
	});
});
