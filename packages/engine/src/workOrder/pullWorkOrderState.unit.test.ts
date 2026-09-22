import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { type LightsoutConfig, WorkOrderEventKind, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerAttachment, TrackerSettings } from '#src/ticketTracker/index.ts';
import { pullWorkOrderState, readWorkOrderState } from '#src/workOrder/index.ts';
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

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The shared fixture typed: the raw JSON shape widens `provider` to `string`. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const configWithTracker: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };

/** A record the contract accepts. `detail` is what a row varies to make two records differ. */
const recordOf = ({ branch = name, detail = 'added plan 001-record' }: { branch?: string; detail?: string } = {}): WorkOrderState => ({
	schemaVersion: 1,
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

/** What the sidecar names as the bytes last published or restored, or nothing when there is no sidecar. */
const syncedHashAt = ({ syncPath }: { syncPath: string }) =>
	existsSync(syncPath) ? (JSON.parse(readFileSync(syncPath, 'utf8')) as { recordSha256?: string }).recordSha256 : undefined;

/**
 * A checkout outside any repository holding no local state file, with a tracker
 * carrying one attachment under whichever title the case names.
 *
 * The shared arrangement above always titles the published copy the way the
 * store does, so this is the one fixture that can carry the other title.
 */
const setupAttachmentTitled = async ({ label, attachmentTitle }: { label: string; attachmentTitle: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-pull-work-order-'));
	const published = recordOf({ branch: label });

	mockGetTicketAttachments.mockResolvedValue([{ id: 'att-1', title: attachmentTitle, url: 'https://uploads.example.com/published-state.json' }]);
	mockReadTicketAsset.mockResolvedValue(JSON.stringify(published));

	const workOrderFolder = await workOrderFolderDir({ cwd, name: label });

	return {
		published,
		statePath: join(workOrderFolder, 'state.json'),
		syncPath: join(workOrderFolder, 'state-sync.json'),
		params: { cwd, name: label, config: configWithTracker, env: { LINEAR_API_KEY: 'lin_key' }, onProgress: () => undefined },
	};
};

describe('pullWorkOrderState', () => {
	test('pullWorkOrderState: takes the published state.json and ignores an attachment titled ticket.json', async () => {
		// The two cases share one pair of tracker doubles, so each is armed
		// immediately before its own pull.
		const stateNamed = await setupAttachmentTitled({ label: 'lo-158-state-file', attachmentTitle: 'state.json' });
		const pulledFromStateJson = await pullWorkOrderState(stateNamed.params);
		const ticketNamed = await setupAttachmentTitled({ label: 'lo-158-legacy-file', attachmentTitle: 'ticket.json' });
		const pulledFromTicketJson = await pullWorkOrderState(ticketNamed.params);

		expect({
			pulledFromStateJson,
			written: JSON.parse(readFileSync(stateNamed.statePath, 'utf8')) as unknown,
			synced: (JSON.parse(readFileSync(stateNamed.syncPath, 'utf8')) as { recordSha256?: string }).recordSha256,
			pulledFromTicketJson,
			wroteForTicketJson: existsSync(ticketNamed.statePath),
		}).toStrictEqual({
			pulledFromStateJson: { record: stateNamed.published },
			written: stateNamed.published,
			synced: sha256({ content: readFileSync(stateNamed.statePath) }),
			pulledFromTicketJson: { record: undefined },
			wroteForTicketJson: false,
		});
	});

	test('pullWorkOrderState: with no ticket-tracker block, answers the local record and never reaches the tracker', async () => {
		const local = recordOf();
		const { params } = await setupPull({ local, config: { gates } });

		const pulled = await pullWorkOrderState(params);

		expect({ pulled, attachmentReads: mockGetTicketAttachments.mock.calls.length }).toStrictEqual({ pulled: { record: local }, attachmentReads: 0 });
	});

	test('pullWorkOrderState: a ticket-tracker block whose API key is missing is an error, not a local-only record', async () => {
		const { params } = await setupPull({ local: recordOf(), env: {} });

		const pulled = await pullWorkOrderState(params);

		expect({ error: errorOf(pulled), attachmentReads: mockGetTicketAttachments.mock.calls.length }).toEqual({
			error: expect.stringContaining('LINEAR_API_KEY'),
			attachmentReads: 0,
		});
	});

	test('pullWorkOrderState: a work order folder name carrying no ticket id is local only and never reaches the tracker', async () => {
		const branch = 'noticket-branch';
		const local = recordOf({ branch });
		const { params } = await setupPull({ local, branch });

		const pulled = await pullWorkOrderState(params);

		expect({ pulled, attachmentReads: mockGetTicketAttachments.mock.calls.length }).toStrictEqual({ pulled: { record: local }, attachmentReads: 0 });
	});

	test("pullWorkOrderState: restores a published state.json into the primary checkout's work order folder when none is local and records its hash", async () => {
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath } = await setupPull({ ticket: { published } });

		const pulled = await pullWorkOrderState(params);

		expect({ pulled, written: JSON.parse(readFileSync(recordPath, 'utf8')), synced: syncedHashAt({ syncPath }) }).toStrictEqual({
			pulled: { record: published },
			written: published,
			synced: sha256({ content: readFileSync(recordPath) }),
		});
	});

	test('pullWorkOrderState: takes the published record when only the published copy moved since the last sync', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath } = await setupPull({ local, syncedTo: local, ticket: { published } });

		const pulled = await pullWorkOrderState(params);

		expect({ pulled, written: JSON.parse(readFileSync(recordPath, 'utf8')), synced: syncedHashAt({ syncPath }) }).toStrictEqual({
			pulled: { record: published },
			written: published,
			synced: sha256({ content: readFileSync(recordPath) }),
		});
	});

	test('pullWorkOrderState: keeps the local record untouched when only the local copy moved', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath, localBytes, syncBytes } = await setupPull({ local, syncedTo: published, ticket: { published } });

		const pulled = await pullWorkOrderState(params);

		expect({ pulled, onDisk: readFileSync(recordPath, 'utf8'), sidecar: readFileSync(syncPath, 'utf8') }).toStrictEqual({
			pulled: { record: local },
			onDisk: localBytes,
			sidecar: syncBytes,
		});
	});

	test('pullWorkOrderState: when both copies moved, changes nothing locally, writes state.published.json and names work-order sync', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, syncPath, publishedPath, localBytes, syncBytes } = await setupPull({
			local,
			syncedTo: recordOf({ detail: 'added plan 001-last-synced' }),
			ticket: { published },
		});

		const pulled = await pullWorkOrderState(params);
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
		expect(error).toEqual(expect.stringContaining(name));
		expect(error).toEqual(expect.stringContaining('local'));
		expect(error).toEqual(expect.stringContaining('published'));
	});

	test('pullWorkOrderState: treats both copies moved to identical content as in sync and records the hash', async () => {
		const agreed = recordOf({ detail: 'added plan 001-agreed' });
		const { params, recordPath, syncPath, publishedPath } = await setupPull({
			local: agreed,
			syncedTo: recordOf({ detail: 'added plan 001-last-synced' }),
			ticket: { published: agreed },
		});

		const pulled = await pullWorkOrderState(params);

		expect({ pulled, synced: syncedHashAt({ syncPath }), surfaced: existsSync(publishedPath) }).toStrictEqual({
			pulled: { record: agreed },
			synced: sha256({ content: readFileSync(recordPath) }),
			surfaced: false,
		});
	});

	test('pullWorkOrderState: with no sync record, a local and a published copy that differ are a divergence', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params, recordPath, publishedPath, localBytes } = await setupPull({ local, ticket: { published } });

		const pulled = await pullWorkOrderState(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8'), surfaced: JSON.parse(readFileSync(publishedPath, 'utf8')) }).toEqual({
			error: expect.stringContaining('lightsout work-order sync'),
			onDisk: localBytes,
			surfaced: published,
		});
	});

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

	test('pullWorkOrderState: a ship.ticket-pattern that captures no ticket group is local only and never reaches the tracker', async () => {
		const local = recordOf();
		const { params } = await setupPull({ local, config: { ...configWithTracker, ship: { 'ticket-pattern': String.raw`^(?<other>lo-\d+)` } } });

		const pulled = await pullWorkOrderState(params);

		expect({ pulled, attachmentReads: mockGetTicketAttachments.mock.calls.length }).toStrictEqual({ pulled: { record: local }, attachmentReads: 0 });
	});

	test("pullWorkOrderState: a fetched record lands in the ticket's own folder", async () => {
		const published = recordOf({ detail: 'added plan 001-published' });
		const { params } = await setupPull({ ticket: { published } });
		const inTicketFolder = join(params.cwd, '.lightsout', 'tickets', name, 'state.json');

		const pulled = await pullWorkOrderState(params);
		const readBack = await readWorkOrderState({ cwd: params.cwd, name });

		expect({ pulled, written: JSON.parse(readFileSync(inTicketFolder, 'utf8')), readBack }).toStrictEqual({
			pulled: { record: published },
			written: published,
			readBack: { record: published },
		});
	});

	test("pullWorkOrderState: refuses a published state.json whose branch is not this work order folder's", async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const { params, recordPath, publishedPath, syncPath, localBytes } = await setupPull({
			local,
			ticket: { published: recordOf({ branch: 'lo-141-elsewhere' }) },
		});

		const pulled = await pullWorkOrderState(params);

		expect({ error: errorOf(pulled), onDisk: readFileSync(recordPath, 'utf8'), surfaced: existsSync(publishedPath), sidecar: existsSync(syncPath) }).toEqual({
			error: expect.stringContaining('lo-141-elsewhere'),
			onDisk: localBytes,
			surfaced: false,
			sidecar: false,
		});
	});

	test('pullWorkOrderState: every unreadable-record and divergence sentence spells the work-order command word', async () => {
		const local = recordOf({ detail: 'added plan 001-local' });
		const published = recordOf({ detail: 'added plan 001-published' });
		// The four cases share one pair of tracker doubles, so each is armed
		// immediately before its own pull.
		const notJson = await setupPull({ local, ticket: { publishedText: '{ "branch": ' } });
		const pulledNotJson = await pullWorkOrderState(notJson.params);
		const offContract = await setupPull({ local, ticket: { publishedText: JSON.stringify({ ...recordOf(), mode: 'multi' }) } });
		const pulledOffContract = await pullWorkOrderState(offContract.params);
		const twice = await setupPull({ local, ticket: { published, publishedTwice: true } });
		const pulledTwice = await pullWorkOrderState(twice.params);
		const diverged = await setupPull({ local, syncedTo: recordOf({ detail: 'added plan 001-last-synced' }), ticket: { published } });
		const pulledDiverged = await pullWorkOrderState(diverged.params);
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
