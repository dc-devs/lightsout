import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { syncTicketRecord } from '#src/ticket/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam: mocking it is what lets a published
// `ticket.json` be planted and an upload be asserted with no network. The ticket
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

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined || block.provider !== 'linear') {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		return { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey: env[block['api-key-env']] ?? '' };
	},
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };
const ticketBranch = 'lo-140-sync';

/** A record the contract accepts, told apart from another copy of itself by its one plan's title. */
const recordOf = ({ title }: { title: string }): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode: 'multiple-plan',
	plans: [{ id: '001-sync', title, progress: 'ready', createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-sync' }],
});

/** The byte form the record travels and hashes in: keys sorted at every depth, tab indented, one trailing newline. */
const serializedOf = ({ record }: { record: TicketRecord }) => {
	const sorted: unknown = JSON.parse(canonicalJson({ value: record }));

	return Buffer.from(`${JSON.stringify(sorted, undefined, '\t')}\n`, 'utf8');
};

/** What the sidecar beside the record says about the bytes this machine last published or restored. */
const syncStateOf = ({ syncPath }: { syncPath: string }) => JSON.parse(readFileSync(syncPath, 'utf8')) as { recordSha256?: string };

/** Every upload of `ticket.json` the tracker was asked for, with the record each one carried. */
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
}: {
	local?: TicketRecord;
	published?: TicketRecord;
	/** The record whose bytes the sidecar remembers as the last published or restored ones. */
	synced?: TicketRecord;
	config?: LightsoutConfig;
	/** The sentence every read of the ticket after the pull's own is refused with, for the guarded upload's re-read. */
	listFailureAfterFirstRead?: string;
	/** Puts a directory where `ticket-sync.json` belongs, so every write of the sidecar fails the way a full or read-only disk would. */
	sidecarUnwritable?: boolean;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-ticket-'));
	const ticketFolder = join(cwd, '.lightsout', 'plans', ticketBranch);
	const recordPath = join(ticketFolder, 'ticket.json');
	const syncPath = join(ticketFolder, 'ticket-sync.json');
	const progress: string[] = [];

	mkdirSync(ticketFolder, { recursive: true });

	if (local !== undefined) {
		writeFileSync(recordPath, serializedOf({ record: local }));
	}

	if (synced !== undefined) {
		const recordSha256 = sha256({ content: serializedOf({ record: synced }) });

		writeFileSync(syncPath, `${JSON.stringify({ schemaVersion: 1, recordSha256, planMarkers: {} }, undefined, '\t')}\n`);
	}

	if (sidecarUnwritable === true) {
		mkdirSync(syncPath, { recursive: true });
	}

	const carried: Attachment[] = published === undefined ? [] : [{ id: 'att-record', title: 'ticket.json', url: 'https://assets.example/ticket.json' }];
	let reads = 0;

	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' }]);
	mockGetTicketAttachments.mockImplementation(async () => {
		reads += 1;

		return listFailureAfterFirstRead !== undefined && reads > 1 ? { error: listFailureAfterFirstRead } : carried;
	});
	mockReadTicketAsset.mockResolvedValue(published === undefined ? { error: 'no asset to read' } : serializedOf({ record: published }).toString('utf8'));
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		recordPath,
		syncPath,
		progress,
		params: { cwd, ticketBranch, config, env, keep: undefined, onProgress: (message: string) => progress.push(message) },
	};
};

describe('syncTicketRecord', () => {
	test('syncTicketRecord: republishes a local record that moved since the last publish', async () => {
		const published = recordOf({ title: 'The last published title' });
		const local = recordOf({ title: 'The local title' });
		const { params, syncPath } = setupSync({ local, published, synced: published });

		const result = await syncTicketRecord(params);

		expect(result).toStrictEqual({ record: local });
		expect(attachedRecords()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', record: local }]);
		expect(syncStateOf({ syncPath }).recordSha256).toBe(sha256({ content: serializedOf({ record: local }) }));
	});

	test('syncTicketRecord: without --keep, reports a divergence and changes nothing', async () => {
		const base = recordOf({ title: 'The last synced title' });
		const local = recordOf({ title: 'The local title' });
		const published = recordOf({ title: 'The published title' });
		const { params, recordPath, syncPath } = setupSync({ local, published, synced: base });

		const result = await syncTicketRecord(params);

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

	test('syncTicketRecord: refuses when neither this machine nor the ticket holds a record to sync', async () => {
		const { params } = setupSync();

		const result = await syncTicketRecord(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('nothing to sync') });
		expect(attachedRecords()).toStrictEqual([]);
	});

	test('syncTicketRecord: sends nothing when the record already matches the bytes this machine last published', async () => {
		const agreed = recordOf({ title: 'The agreed title' });
		const { params, progress, syncPath } = setupSync({ local: agreed, published: agreed, synced: agreed });

		const result = await syncTicketRecord(params);

		expect(result).toStrictEqual({ record: agreed });
		expect(attachedRecords()).toStrictEqual([]);
		expect(progress).toContainEqual(expect.stringContaining('already matches'));
		expect(syncStateOf({ syncPath }).recordSha256).toBe(sha256({ content: serializedOf({ record: agreed }) }));
	});

	test('syncTicketRecord: sends nothing when the ticket cannot be re-read immediately before the upload', async () => {
		const published = recordOf({ title: 'The last published title' });
		const local = recordOf({ title: 'The local title' });
		const { params, syncPath } = setupSync({ local, published, synced: published, listFailureAfterFirstRead: 'the tracker API answered 503' });

		const result = await syncTicketRecord(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('the tracker API answered 503') });
		expect(attachedRecords()).toStrictEqual([]);
		expect(syncStateOf({ syncPath }).recordSha256).toBe(sha256({ content: serializedOf({ record: published }) }));
	});

	test('syncTicketRecord: says the record was published but not remembered when the sidecar cannot be written', async () => {
		// The upload is the part that matters to the ticket, so it still happens;
		// what is lost is only this machine's memory of having sent those bytes.
		const local = recordOf({ title: 'The local title' });
		const { params } = setupSync({ local, sidecarUnwritable: true });

		const result = await syncTicketRecord(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('could not record that it was') });
		expect(attachedRecords()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', record: local }]);
	});

	test('syncTicketRecord: refuses when the repository configures no ticket tracker', async () => {
		const { params } = setupSync({ local: recordOf({ title: 'The local title' }), config: { gates } });

		const result = await syncTicketRecord(params);

		expect(result).toStrictEqual({ error: expect.stringMatching(/ticket[ -]tracker/u) });
		expect(result).toStrictEqual({ error: expect.stringContaining('needs a configured tracker to sync against') });
		expect({ reads: mockGetTicketAttachments.mock.calls.length, uploads: mockSetTicketAttachment.mock.calls.length }).toStrictEqual({ reads: 0, uploads: 0 });
	});

	test("syncTicketRecord: answers the tracker resolver's own refusal when a configured tracker cannot be used", async () => {
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

		const result = await syncTicketRecord(params);

		expect(result).toStrictEqual({ error: expect.stringContaining('lightsout.config.json') });
		expect(result).not.toStrictEqual({ error: expect.stringContaining('needs a configured tracker to sync against') });
		expect({ reads: mockGetTicketAttachments.mock.calls.length, uploads: mockSetTicketAttachment.mock.calls.length }).toStrictEqual({ reads: 0, uploads: 0 });
	});
});
