import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type LightsoutConfig, TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { pullTicketRecord, updateLocalTicketRecord } from '#src/ticket/index.ts';
import type { TrackerAttachment, TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

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
const assetUrl = 'https://uploads.example.com/ticket.json';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The shared fixture typed: the raw JSON shape widens `provider` to `string`. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const configWithTracker: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };
const linearEnv = { LINEAR_API_KEY: 'lin_key' };

/** A record the contract accepts. `detail` is what a row varies to make two records differ. */
const recordOf = ({ branch = ticketBranch, detail = 'added plan 001-record' }: { branch?: string; detail?: string } = {}): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch,
	mode: TicketMode.SinglePlan,
	plans: [],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail }],
});

/**
 * The exact bytes the store writes for a record, taken from a throwaway
 * checkout, so a row can name the hash a sidecar holds without this file ever
 * restating the record's byte form.
 */
const canonicalBytesOf = async ({ record }: { record: TicketRecord }): Promise<Buffer> => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-bytes-'));
	const written = await updateLocalTicketRecord({ cwd, ticketBranch: record.branch, change: () => record });

	if ('error' in written) {
		throw new Error(written.error);
	}

	return readFileSync(join(cwd, '.lightsout', 'plans', record.branch, 'ticket.json'));
};

/** The ticket's own side of an arrangement: what it carries, and how it refuses to answer. */
interface TicketSide {
	/** The record the ticket carries as `ticket.json`. */
	published?: TicketRecord;
	/** Raw text for the published `ticket.json`, for the rows where it is not a valid record. */
	publishedText?: string;
	/** What the ticket's attachment list answers. Defaults to one `ticket.json` when a published copy is given. */
	attachments?: TrackerAttachment[];
	/** The sentence the tracker refuses the attachment list with. */
	listFailure?: string;
	/** The sentence the tracker refuses the read of the attachment's own bytes with. */
	assetFailure?: string;
}

/**
 * A checkout outside any repository, so the shared state directory is its own
 * and the ticket folder is a path the row can name: a local record seeded
 * through the store, a sidecar naming the bytes of whichever record last
 * synced, and whatever the ticket carries.
 */
const setupPull = async ({
	local,
	syncedTo,
	ticket = {},
	config = configWithTracker,
	env = linearEnv,
	branch = ticketBranch,
}: {
	/** The record already in the primary checkout, or none. */
	local?: TicketRecord;
	/** The record whose bytes the sidecar names as last published or restored. No sidecar when absent. */
	syncedTo?: TicketRecord;
	/** What the ticket itself answers with. Nothing at all is a ticket carrying no record. */
	ticket?: TicketSide;
	config?: LightsoutConfig;
	env?: NodeJS.ProcessEnv;
	branch?: string;
} = {}) => {
	const { published, publishedText, attachments, listFailure, assetFailure } = ticket;
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-pull-ticket-'));
	const ticketFolder = join(cwd, '.lightsout', 'plans', branch);
	const recordPath = join(ticketFolder, 'ticket.json');
	const syncPath = join(ticketFolder, 'ticket-sync.json');
	const publishedPath = join(ticketFolder, 'ticket.published.json');
	const text = publishedText ?? (published === undefined ? undefined : JSON.stringify(published));
	const progress: string[] = [];

	mockGetTicketAttachments.mockResolvedValue(
		listFailure === undefined ? (attachments ?? (text === undefined ? [] : [{ id: 'att-1', title: 'ticket.json', url: assetUrl }])) : { error: listFailure },
	);
	mockReadTicketAsset.mockResolvedValue(assetFailure === undefined ? (text ?? { error: 'the attachment could not be read' }) : { error: assetFailure });

	if (local !== undefined) {
		const seeded = await updateLocalTicketRecord({ cwd, ticketBranch: branch, change: () => local });

		if ('error' in seeded) {
			throw new Error(seeded.error);
		}
	}

	if (syncedTo !== undefined) {
		mkdirSync(ticketFolder, { recursive: true });
		writeFileSync(
			syncPath,
			JSON.stringify({ schemaVersion: 1, recordSha256: sha256({ content: await canonicalBytesOf({ record: syncedTo }) }), planMarkers: {} }),
		);
	}

	return {
		cwd,
		recordPath,
		syncPath,
		publishedPath,
		localBytes: local === undefined ? undefined : readFileSync(recordPath).toString('utf8'),
		syncBytes: syncedTo === undefined ? undefined : readFileSync(syncPath).toString('utf8'),
		params: { cwd, ticketBranch: branch, config, env, onProgress: (message: string) => progress.push(message) },
	};
};

/** The refusal an answer carries, so a row can read one sentence out of the union. */
const errorOf = (answer: { record: TicketRecord | undefined } | { error: string }) => ('error' in answer ? answer.error : undefined);

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

	test('pullTicketRecord: when both copies moved, changes nothing locally, writes ticket.published.json and names ticket sync', async () => {
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
		expect(error).toEqual(expect.stringContaining('lightsout ticket sync'));
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
			error: expect.stringContaining('lightsout ticket sync'),
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
		const twice = await setupPull({
			local,
			ticket: {
				published: recordOf({ detail: 'added plan 001-published' }),
				attachments: [
					{ id: 'att-1', title: 'ticket.json', url: assetUrl },
					{ id: 'att-2', title: 'ticket.json', url: `${assetUrl}?second` },
				],
			},
		});
		const pulledTwice = await pullTicketRecord(twice.params);

		expect({
			offContract: errorOf(pulledOffContract),
			offContractOnDisk: readFileSync(offContract.recordPath, 'utf8'),
			twice: errorOf(pulledTwice),
			twiceOnDisk: readFileSync(twice.recordPath, 'utf8'),
		}).toEqual({
			offContract: expect.stringContaining('ticket sync'),
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
});
