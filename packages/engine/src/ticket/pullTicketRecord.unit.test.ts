import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type LightsoutConfig, WorkOrderEventKind, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import { pullTicketRecord, readTicketRecord } from '#src/ticket/index.ts';
import type { TrackerAttachment, TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { setupPullTicketRecord } from '#tests/helpers/setupPullTicketRecord.ts';

// Mocked Imports
// -------------------------
// Only the two reads that would touch the network are doubled. Everything else
// the pull composes — which tracker is configured, whether the folder name
// carries a ticket id, the record contract, the byte form and the lock — is the
// real thing, because the three-way rule under test is decided by those bytes.
type TrackerFailure = { error: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketTracker/index.ts')>('#src/ticketTracker/index.ts'),
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The shared fixture typed: the raw JSON shape widens `provider` to `string`. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const configWithTracker: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };

/** A record the contract accepts. `detail` is what a row varies to make two records differ. */
const recordOf = ({ branch = ticketBranch, detail = 'added plan 001-record' }: { branch?: string; detail?: string } = {}): WorkOrderState => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch,
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail }],
});

/**
 * The shared pull arrangement, handed this file's own tracker doubles: a
 * throwaway checkout whose ticket folder holds whatever the row describes.
 */
const setupPull = (params: Omit<Parameters<typeof setupPullTicketRecord>[0], 'mocks'> = {}) =>
	setupPullTicketRecord({ ...params, mocks: { getTicketAttachments: mockGetTicketAttachments, readTicketAsset: mockReadTicketAsset } });

/** The refusal an answer carries, so a row can read one sentence out of the union. */
const errorOf = (answer: { record: WorkOrderState | undefined } | { error: string }) => ('error' in answer ? answer.error : undefined);

/** What the sidecar names as the bytes last published or restored, or nothing when there is no sidecar. */
const syncedHashAt = ({ syncPath }: { syncPath: string }) =>
	existsSync(syncPath) ? (JSON.parse(readFileSync(syncPath, 'utf8')) as { recordSha256?: string }).recordSha256 : undefined;

describe('pullTicketRecord', () => {
	test('pullTicketRecord: with no ticket-tracker block, answers the local record and never reaches the tracker', async () => {
		const local = recordOf();
		const { params } = await setupPull({ local, config: { gates } });

		const pulled = await pullTicketRecord(params);

		expect({ pulled, attachmentReads: mockGetTicketAttachments.mock.calls.length }).toStrictEqual({ pulled: { record: local }, attachmentReads: 0 });
	});

	test('pullTicketRecord: a ticket-tracker block whose API key is missing is an error, not a local-only record', async () => {
		const { params } = await setupPull({ local: recordOf(), env: {} });

		const pulled = await pullTicketRecord(params);

		expect({ error: errorOf(pulled), attachmentReads: mockGetTicketAttachments.mock.calls.length }).toEqual({
			error: expect.stringContaining('LINEAR_API_KEY'),
			attachmentReads: 0,
		});
	});

	test('pullTicketRecord: a ticket folder name carrying no ticket id is local only and never reaches the tracker', async () => {
		const branch = 'noticket-branch';
		const local = recordOf({ branch });
		const { params } = await setupPull({ local, branch });

		const pulled = await pullTicketRecord(params);

		expect({ pulled, attachmentReads: mockGetTicketAttachments.mock.calls.length }).toStrictEqual({ pulled: { record: local }, attachmentReads: 0 });
	});

	test("pullTicketRecord: restores a published ticket.json into the primary checkout's ticket folder when none is local and records its hash", async () => {
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath } = await setupPull({ ticket: { published } });

		const pulled = await pullTicketRecord(params);

		expect({ pulled, written: JSON.parse(readFileSync(recordPath, 'utf8')), synced: syncedHashAt({ syncPath }) }).toStrictEqual({
			pulled: { record: published },
			written: published,
			synced: sha256({ content: readFileSync(recordPath) }),
		});
	});

	test('pullTicketRecord: takes the published record when only the published copy moved since the last sync', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath } = await setupPull({ local, syncedTo: local, ticket: { published } });

		const pulled = await pullTicketRecord(params);

		expect({ pulled, written: JSON.parse(readFileSync(recordPath, 'utf8')), synced: syncedHashAt({ syncPath }) }).toStrictEqual({
			pulled: { record: published },
			written: published,
			synced: sha256({ content: readFileSync(recordPath) }),
		});
	});

	test('pullTicketRecord: keeps the local record untouched when only the local copy moved', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath, localBytes, syncBytes } = await setupPull({ local, syncedTo: published, ticket: { published } });

		const pulled = await pullTicketRecord(params);

		expect({ pulled, onDisk: readFileSync(recordPath, 'utf8'), sidecar: readFileSync(syncPath, 'utf8') }).toStrictEqual({
			pulled: { record: local },
			onDisk: localBytes,
			sidecar: syncBytes,
		});
	});

	test('pullTicketRecord: when both copies moved, changes nothing locally, writes ticket.published.json and names work-order sync', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath, publishedPath, localBytes, syncBytes } = await setupPull({
			local,
			syncedTo: recordOf({ detail: 'added plan 001-last-synced' }),
			ticket: { published },
		});

		const pulled = await pullTicketRecord(params);
		const error = errorOf(pulled);

		expect({
			onDisk: readFileSync(recordPath, 'utf8'),
			sidecar: readFileSync(syncPath, 'utf8'),
			surfaced: JSON.parse(readFileSync(publishedPath, 'utf8')),
		}).toStrictEqual({
			onDisk: localBytes,
			sidecar: syncBytes,
			surfaced: published,
		});
		expect(error).toEqual(expect.stringContaining('lightsout work-order sync'));
		expect(error).toEqual(expect.stringContaining(ticketBranch));
		expect(error).toEqual(expect.stringContaining('local'));
		expect(error).toEqual(expect.stringContaining('published'));
	});

	test('pullTicketRecord: treats both copies moved to identical content as in sync and records the hash', async () => {
		const agreed = recordOf({ detail: 'added plan 001-agreed' });
		const { params, recordPath, syncPath, publishedPath } = await setupPull({
			local: agreed,
			syncedTo: recordOf({ detail: 'added plan 001-last-synced' }),
			ticket: { published: agreed },
		});

		const pulled = await pullTicketRecord(params);

		expect({ pulled, synced: syncedHashAt({ syncPath }), surfaced: existsSync(publishedPath) }).toStrictEqual({
			pulled: { record: agreed },
			synced: sha256({ content: readFileSync(recordPath) }),
			surfaced: false,
		});
	});

	test('pullTicketRecord: with no sync record, a local and a published copy that differ are a divergence', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, publishedPath, localBytes } = await setupPull({ local, ticket: { published } });

		const pulled = await pullTicketRecord(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8'), surfaced: JSON.parse(readFileSync(publishedPath, 'utf8')) }).toEqual({
			error: expect.stringContaining('lightsout work-order sync'),
			onDisk: localBytes,
			surfaced: published,
		});
	});

	test('pullTicketRecord: refuses a published ticket.json that is not a valid ticket record, and one that appears twice', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		// Each case is armed immediately before its own pull: the two share one
		// pair of tracker doubles, so arming both up front would leave the first
		// pull reading the second case's ticket.
		const offContract = await setupPull({ local, ticket: { publishedText: JSON.stringify({ ...recordOf(), mode: 'multi' }) } });
		const pulledOffContract = await pullTicketRecord(offContract.params);
		const twice = await setupPull({ local, ticket: { published: recordOf({ detail: 'added plan 001-published' }), publishedTwice: true } });
		const pulledTwice = await pullTicketRecord(twice.params);

		expect({
			offContract: errorOf(pulledOffContract),
			offContractOnDisk: readFileSync(offContract.recordPath, 'utf8'),
			twice: errorOf(pulledTwice),
			twiceOnDisk: readFileSync(twice.recordPath, 'utf8'),
		}).toEqual({
			offContract: expect.stringContaining('work-order sync'),
			offContractOnDisk: offContract.localBytes,
			twice: expect.stringContaining('ticket.json'),
			twiceOnDisk: twice.localBytes,
		});
	});

	test("pullTicketRecord: refuses when the tracker cannot list the ticket's attachments", async () => {
		const { params, recordPath, localBytes } = await setupPull({
			local: recordOf({ detail: 'added plan 001-local' }),
			ticket: { listFailure: 'the tracker API answered 503' },
		});

		const pulled = await pullTicketRecord(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8') }).toEqual({
			error: expect.stringContaining('the tracker API answered 503'),
			onDisk: localBytes,
		});
	});

	test('pullTicketRecord: refuses when the published ticket.json cannot be read', async () => {
		const { params, recordPath, localBytes } = await setupPull({
			local: recordOf({ detail: 'added plan 001-local' }),
			ticket: { published: recordOf({ detail: 'added plan 001-published' }), assetFailure: 'the upload store answered 404' },
		});

		const pulled = await pullTicketRecord(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8') }).toEqual({
			error: expect.stringContaining('the upload store answered 404'),
			onDisk: localBytes,
		});
	});

	test('pullTicketRecord: refuses a published ticket.json that is not JSON at all', async () => {
		const { params, recordPath, localBytes } = await setupPull({
			local: recordOf({ detail: 'added plan 001-local' }),
			ticket: { publishedText: '{ "branch": ' },
		});

		const pulled = await pullTicketRecord(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8') }).toEqual({
			error: expect.stringContaining('is not valid JSON'),
			onDisk: localBytes,
		});
	});

	test('pullTicketRecord: a ship.ticket-pattern that captures no ticket group is local only and never reaches the tracker', async () => {
		const local = recordOf();
		const { params } = await setupPull({ local, config: { ...configWithTracker, ship: { 'ticket-pattern': String.raw`^(?<other>lo-\d+)` } } });

		const pulled = await pullTicketRecord(params);

		expect({ pulled, attachmentReads: mockGetTicketAttachments.mock.calls.length }).toStrictEqual({ pulled: { record: local }, attachmentReads: 0 });
	});

	test("pullTicketRecord: a fetched record lands in the ticket's own folder", async () => {
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params } = await setupPull({ ticket: { published } });
		const inTicketFolder = join(params.cwd, '.lightsout', 'tickets', ticketBranch, 'ticket.json');

		const pulled = await pullTicketRecord(params);
		const readBack = await readTicketRecord({ cwd: params.cwd, ticketBranch });

		expect({ pulled, written: JSON.parse(readFileSync(inTicketFolder, 'utf8')), readBack }).toStrictEqual({
			pulled: { record: published },
			written: published,
			readBack: { record: published },
		});
	});

	test("pullTicketRecord: refuses a published ticket.json whose branch is not this ticket folder's", async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const { params, recordPath, publishedPath, syncPath, localBytes } = await setupPull({
			local,
			ticket: { published: recordOf({ branch: 'lo-141-elsewhere' }) },
		});

		const pulled = await pullTicketRecord(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8'), surfaced: existsSync(publishedPath), sidecar: existsSync(syncPath) }).toEqual({
			error: expect.stringContaining('lo-141-elsewhere'),
			onDisk: localBytes,
			surfaced: false,
			sidecar: false,
		});
	});

	test('pullTicketRecord: every unreadable-record and divergence sentence spells the work-order command word', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		// The four cases share one pair of tracker doubles, so each is armed
		// immediately before its own pull.
		const notJson = await setupPull({ local, ticket: { publishedText: '{ "branch": ' } });
		const pulledNotJson = await pullTicketRecord(notJson.params);
		const offContract = await setupPull({ local, ticket: { publishedText: JSON.stringify({ ...recordOf(), mode: 'multi' }) } });
		const pulledOffContract = await pullTicketRecord(offContract.params);
		const twice = await setupPull({ local, ticket: { published, publishedTwice: true } });
		const pulledTwice = await pullTicketRecord(twice.params);
		const diverged = await setupPull({ local, syncedTo: recordOf({ detail: 'added plan 001-last-synced' }), ticket: { published } });
		const pulledDiverged = await pullTicketRecord(diverged.params);
		const sentences = {
			notJson: errorOf(pulledNotJson),
			offContract: errorOf(pulledOffContract),
			twice: errorOf(pulledTwice),
			diverged: errorOf(pulledDiverged),
		};

		expect(sentences).toEqual({
			notJson: expect.stringContaining('lightsout work-order sync'),
			offContract: expect.stringContaining('lightsout work-order sync'),
			twice: expect.stringContaining('lightsout work-order sync'),
			diverged: expect.stringContaining('lightsout work-order sync'),
		});
		expect(Object.values(sentences).join('\n')).not.toMatch(/lightsout ticket\b/);
	});
});
