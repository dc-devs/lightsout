import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { syncWorkOrderState } from '#src/workOrder/syncWorkOrderState.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam: mocking it is what lets a published
// `state.json` be planted and an upload be asserted with no network. The ticket
// folder, its record and its sync sidecar are real temporary files, because
// which bytes end up on disk is what this function is about.
type TrackerFailure = { error: string };
type TrackerTicket = { id: string; identifier: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/getTicketAttachments.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
}));
jest.mock('#src/ticketTracker/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
jest.mock('#src/ticketTracker/readTicketAsset.ts', () => ({ readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params) }));
jest.mock('#src/ticketTracker/resolveTrackerSettings.ts', () => ({
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined || block.provider !== 'linear') {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		return { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey: env[block['api-key-env']] ?? '' };
	},
}));
jest.mock('#src/ticketTracker/setTicketAttachment.ts', () => ({ setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };
const name = 'lo-140-sync';

/** A record the contract accepts, told apart from another copy of itself by its one plan's title. */
const recordOf = ({ title }: { title: string }): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: 'multiple-plan',
	plans: [{ id: '001-sync', title, progress: 'ready', createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-sync' }],
});

/** The byte form the record travels and hashes in: keys sorted at every depth, tab indented, one trailing newline. */
const serializedOf = ({ record }: { record: WorkOrderState }) => {
	const sorted: unknown = JSON.parse(canonicalJson({ value: record }));

	return Buffer.from(`${JSON.stringify(sorted, undefined, '\t')}\n`, 'utf8');
};

/** What the sidecar beside the record says about the bytes this machine last published or restored. */
const syncStateOf = ({ syncPath }: { syncPath: string }) => JSON.parse(readFileSync(syncPath, 'utf8')) as { recordSha256?: string };

/** Every upload of `state.json` the tracker was asked for, with the record each one carried. */
const attachedRecords = () =>
	mockSetTicketAttachment.mock.calls.map(([call]) => ({
		title: call.title,
		contentType: call.contentType,
		record: JSON.parse(call.content.toString('utf8')) as unknown,
	}));

/**
 * A checkout with no repository above it, so its own plans folder is the shared
 * state folder, holding whichever of the three copies a case needs: the local
 * record, the ticket's published one, and the sidecar naming the bytes this
 * machine last synced.
 */
const setupSync = ({
	local,
	published,
	synced,
	config = { gates, 'ticket-tracker': trackerBlock },
	listFailureAfterFirstRead,
	sidecarUnwritable,
	localText,
}: {
	local?: WorkOrderState;
	published?: WorkOrderState;
	/** The record whose bytes the sidecar remembers as the last published or restored ones. */
	synced?: WorkOrderState;
	config?: LightsoutConfig;
	/** The sentence every read of the ticket after the pull's own is refused with, for the guarded upload's re-read. */
	listFailureAfterFirstRead?: string;
	/** Puts a directory where `state-sync.json` belongs, so every write of the sidecar fails the way a full or read-only disk would. */
	sidecarUnwritable?: boolean;
	/** The raw bytes written as `state.json`, for a record no reader can parse. */
	localText?: string;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-ticket-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const recordPath = join(workOrderFolder, 'state.json');
	const syncPath = join(workOrderFolder, 'state-sync.json');
	const progress: string[] = [];

	mkdirSync(workOrderFolder, { recursive: true });

	if (local !== undefined) {
		writeFileSync(recordPath, serializedOf({ record: local }));
	}

	if (localText !== undefined) {
		writeFileSync(recordPath, localText);
	}

	if (synced !== undefined) {
		const recordSha256 = sha256({ content: serializedOf({ record: synced }) });

		writeFileSync(syncPath, `${JSON.stringify({ schemaVersion: 1, recordSha256, planMarkers: {} }, undefined, '\t')}\n`);
	}

	if (sidecarUnwritable === true) {
		mkdirSync(syncPath, { recursive: true });
	}

	const carried: Attachment[] = published === undefined ? [] : [{ id: 'att-record', title: 'state.json', url: 'https://assets.example/state.json' }];
	let reads = 0;

	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' }]);
	mockGetTicketAttachments.mockImplementation(async () => {
		reads += 1;

		return listFailureAfterFirstRead !== undefined && reads > 1 ? { error: listFailureAfterFirstRead } : carried;
	});
	mockReadTicketAsset.mockResolvedValue(published === undefined ? { error: 'no asset to read' } : serializedOf({ record: published }).toString('utf8'));
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		workOrderFolder,
		recordPath,
		syncPath,
		progress,
		params: { cwd, name, config, env, keep: undefined, onProgress: (message: string) => progress.push(message) },
	};
};

/** Whatever was surfaced as the published copy, or nothing when no divergence wrote one. */
const surfacedAt = ({ workOrderFolder }: { workOrderFolder: string }) => {
	const publishedPath = join(workOrderFolder, 'state.published.json');

	return existsSync(publishedPath) ? (JSON.parse(readFileSync(publishedPath, 'utf8')) as unknown) : undefined;
};

/** Whether any of the four names the state files carried before the rename was written. */
const oldNamesAt = ({ workOrderFolder }: { workOrderFolder: string }) =>
	['ticket.json', 'ticket-sync.json', 'ticket.published.json', 'ticket.lock'].filter((fileName) => existsSync(join(workOrderFolder, fileName)));

describe('syncWorkOrderState', () => {
	test('syncWorkOrderState: the sidecar is state-sync.json and a surfaced divergence is state.published.json', async () => {
		// Two arrangements, because the two halves of this contract are opposite
		// branches of one decision: a local copy that moved alone is published and
		// remembered in the sidecar, and a local copy that moved while the published
		// one moved too is settled by nobody but a human.
		const lastPublished = recordOf({ title: 'The last published title' });
		const movedLocally = recordOf({ title: 'The local title' });
		const caughtUp = setupSync({ local: movedLocally, published: lastPublished, synced: lastPublished });

		const republished = await syncWorkOrderState(caughtUp.params);

		expect({
			result: republished,
			recordSha256: syncStateOf({ syncPath: caughtUp.syncPath }).recordSha256,
			oldNames: oldNamesAt({ workOrderFolder: caughtUp.workOrderFolder }),
		}).toStrictEqual({
			result: { record: movedLocally },
			recordSha256: sha256({ content: serializedOf({ record: movedLocally }) }),
			oldNames: [],
		});

		const movedOnTracker = recordOf({ title: 'The published title' });
		const diverged = setupSync({ local: movedLocally, published: movedOnTracker, synced: recordOf({ title: 'The last synced title' }) });

		const refused = await syncWorkOrderState(diverged.params);

		expect({
			surfaced: surfacedAt({ workOrderFolder: diverged.workOrderFolder }),
			oldNames: oldNamesAt({ workOrderFolder: diverged.workOrderFolder }),
		}).toStrictEqual({ surfaced: movedOnTracker, oldNames: [] });
		expect(refused).toStrictEqual({ error: expect.stringContaining('state.published.json') });
	});

	test('syncWorkOrderState: republishes a local record that moved since the last publish', async () => {
		const published = recordOf({ title: 'The last published title' });
		const local = recordOf({ title: 'The local title' });
		const { params, syncPath } = setupSync({ local, published, synced: published });

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ record: local });
		expect(attachedRecords()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', record: local }]);
		expect(syncStateOf({ syncPath }).recordSha256).toBe(sha256({ content: serializedOf({ record: local }) }));
	});

	test('syncWorkOrderState: without --keep, reports a divergence and changes nothing', async () => {
		const base = recordOf({ title: 'The last synced title' });
		const local = recordOf({ title: 'The local title' });
		const published = recordOf({ title: 'The published title' });
		const { params, recordPath, syncPath } = setupSync({ local, published, synced: base });

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('--keep') });
		expect({
			localBytes: readFileSync(recordPath, 'utf8'),
			recordSha256: syncStateOf({ syncPath }).recordSha256,
			uploads: attachedRecords(),
		}).toStrictEqual({
			localBytes: serializedOf({ record: local }).toString('utf8'),
			recordSha256: sha256({ content: serializedOf({ record: base }) }),
			uploads: [],
		});
	});

	test('syncWorkOrderState: refuses when neither this machine nor the ticket holds a record to sync', async () => {
		const { params } = setupSync();

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('nothing to sync') });
		expect(attachedRecords()).toStrictEqual([]);
	});

	test('syncWorkOrderState: sends nothing when the record already matches the bytes this machine last published', async () => {
		const agreed = recordOf({ title: 'The agreed title' });
		const { params, progress, syncPath } = setupSync({ local: agreed, published: agreed, synced: agreed });

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ record: agreed });
		expect(attachedRecords()).toStrictEqual([]);
		expect(progress).toContainEqual(expect.stringContaining('already matches'));
		expect(syncStateOf({ syncPath }).recordSha256).toBe(sha256({ content: serializedOf({ record: agreed }) }));
	});

	test('syncWorkOrderState: sends nothing when the ticket cannot be re-read immediately before the upload', async () => {
		const published = recordOf({ title: 'The last published title' });
		const local = recordOf({ title: 'The local title' });
		const { params, syncPath } = setupSync({ local, published, synced: published, listFailureAfterFirstRead: 'the tracker API answered 503' });

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('the tracker API answered 503') });
		expect(attachedRecords()).toStrictEqual([]);
		expect(syncStateOf({ syncPath }).recordSha256).toBe(sha256({ content: serializedOf({ record: published }) }));
	});

	test('syncWorkOrderState: says the record was published but not remembered when the sidecar cannot be written', async () => {
		// The upload is the part that matters to the ticket, so it still happens;
		// what is lost is only this machine's memory of having sent those bytes.
		const local = recordOf({ title: 'The local title' });
		const { params } = setupSync({ local, sidecarUnwritable: true });

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('could not record that it was') });
		expect(attachedRecords()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', record: local }]);
	});

	test('syncWorkOrderState: refuses when the repository configures no ticket tracker', async () => {
		const { params } = setupSync({ local: recordOf({ title: 'The local title' }), config: { gates } });

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ error: expect.stringMatching(/ticket[ -]tracker/u) });
		expect(result).toStrictEqual({ error: expect.stringContaining('needs a configured tracker to sync against') });
		expect({ reads: mockGetTicketAttachments.mock.calls.length, uploads: mockSetTicketAttachment.mock.calls.length }).toStrictEqual({ reads: 0, uploads: 0 });
	});

	test("syncWorkOrderState: answers the tracker resolver's own refusal when a configured tracker cannot be used", async () => {
		// A tracker that IS configured and cannot be resolved is a different answer
		// from a repository that configures none: reporting it as local only would
		// let a published record move with nobody ever noticing.
		const { params } = setupSync({
			local: recordOf({ title: 'The local title' }),
			config: {
				gates,
				'ticket-tracker': {
					provider: 'jira',
					'site-url': 'https://example.atlassian.net',
					project: 'LO',
					'api-key-env': 'JIRA_API_KEY',
					'api-user-email-env': 'JIRA_API_USER_EMAIL',
				},
			},
		});

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('lightsout.config.json') });
		expect(result).not.toStrictEqual({ error: expect.stringContaining('needs a configured tracker to sync against') });
		expect({ reads: mockGetTicketAttachments.mock.calls.length, uploads: mockSetTicketAttachment.mock.calls.length }).toStrictEqual({ reads: 0, uploads: 0 });
	});

	test('refuses to sync a work order that belongs to no ticket', async () => {
		// The record is the only thing that says which ticket this work belongs to,
		// so a record carrying none has nowhere to publish. The refusal has to name
		// the absent reference rather than blame the folder's name for carrying no
		// ticket id, which is what it used to do.
		const belongsToNoTicket: WorkOrderState = { ...recordOf({ title: 'The local title' }), ticketRef: undefined };
		const { params } = setupSync({ local: belongsToNoTicket });

		const result = await syncWorkOrderState(params);

		const refusal = 'error' in result ? result.error : undefined;

		expect(refusal).toEqual(expect.stringContaining('lo-140-sync'));
		expect(refusal).toEqual(expect.stringMatching(/ticket reference/iu));
		expect(refusal).toEqual(expect.stringContaining('needs a configured tracker to sync against'));
		// The two halves of the sentence this row replaced: a folder name read for
		// a ticket id, and the pattern it was read with.
		expect(refusal).not.toEqual(expect.stringContaining('folder name'));
		expect(refusal).not.toEqual(expect.stringContaining('ship.ticket-pattern'));
		expect({ reads: mockGetTicketAttachments.mock.calls.length, uploads: mockSetTicketAttachment.mock.calls.length }).toStrictEqual({ reads: 0, uploads: 0 });
	});

	test("syncWorkOrderState: refuses when this machine's own record cannot be read, before any tracker is asked", async () => {
		// The record is read first now, so a record nothing can parse is refused by
		// the file's own name — there is no ticket reference to resolve a tracker
		// from, and nothing else on this machine answers which ticket to ask.
		const { params, recordPath } = setupSync({ localText: '{ half a record' });

		const result = await syncWorkOrderState(params);

		expect(result).toStrictEqual({ error: expect.stringContaining(recordPath) });
		expect({ reads: mockGetTicketAttachments.mock.calls.length, uploads: mockSetTicketAttachment.mock.calls.length }).toStrictEqual({ reads: 0, uploads: 0 });
	});

	test('syncWorkOrderState: the local-only refusal spells the work-order command word', async () => {
		const { params } = setupSync({ local: recordOf({ title: 'The local title' }), config: { gates } });

		const result = await syncWorkOrderState(params);

		const refusal = 'error' in result ? result.error : undefined;

		expect(refusal).toEqual(expect.stringContaining('lightsout work-order sync'));
		// The old command word anywhere in the sentence is the failure this row
		// exists for, so it is checked for as well as for the new one.
		expect(refusal).not.toEqual(expect.stringContaining('lightsout ticket '));
		expect({ reads: mockGetTicketAttachments.mock.calls.length, uploads: mockSetTicketAttachment.mock.calls.length }).toStrictEqual({ reads: 0, uploads: 0 });
	});
});
