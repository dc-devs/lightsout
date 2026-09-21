import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type LightsoutConfig, TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { updateLocalTicketRecord, updateSyncedTicketRecord } from '#src/ticket/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { canonicalTicketRecordText } from '#tests/helpers/canonicalTicketRecordText.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam mocked: the record, its sidecar and the
// surfaced published copy are real files in a temporary checkout, because what
// this function promises is about which bytes reach disk and which reach the
// ticket.
type TrackerFailure = { error: string };
type TrackerTicket = { id: string; identifier: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();
const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined) {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		const apiKey = env[block['api-key-env']] ?? '';

		return apiKey === ''
			? { error: `the tracker API key is missing: set the \`${block['api-key-env']}\` environment variable` }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey };
	},
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';
const assetUrl = 'https://assets.example.com/ticket.json';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };

/** A record the contract accepts, carrying one history event per detail given. */
const recordOf = ({ details = [] }: { details?: string[] } = {}): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode: TicketMode.SinglePlan,
	plans: [],
	history: details.map((detail, index) => ({ at: `2026-01-0${index + 1}T00:00:00.000Z`, kind: TicketEventKind.PlanAdded, detail })),
});

const withEvent = ({ record, detail }: { record: TicketRecord; detail: string }): TicketRecord => ({
	...record,
	history: [...record.history, { at: '2026-02-01T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail }],
});

/** The record the rows start from, the copy a moved ticket carries, and the copy a second machine publishes. */
const localRecord = recordOf({ details: ['added plan 001-record'] });
const movedPublished = recordOf({ details: ['added plan 001-record', 'added plan 002-queue-order'] });
const otherPublished = recordOf({ details: ['added plan 001-record', 'added plan 004-elsewhere'] });

const setupSyncedRecord = async ({
	local = localRecord,
	published,
	sidecarOf,
	config = { gates, 'ticket-tracker': trackerBlock },
	uploadFailure,
	detail = 'added plan 003-ship-guard',
	refusal,
	sidecarUnwritable,
}: {
	/** The record already on this machine. */
	local?: TicketRecord;
	/** The record the ticket carries, or nothing published at all. */
	published?: TicketRecord;
	/** The record whose hash `ticket-sync.json` holds, or no sidecar at all. */
	sidecarOf?: TicketRecord;
	config?: LightsoutConfig;
	/** The sentence the tracker refuses the upload with. */
	uploadFailure?: string;
	/** The history detail the change appends. */
	detail?: string;
	/** When set, the change refuses with this sentence instead of appending. */
	refusal?: string;
	/** Puts a directory where `ticket-sync.json` belongs, so every write of the sidecar fails the way a full or read-only disk would. */
	sidecarUnwritable?: boolean;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-synced-record-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);
	const recordPath = join(ticketFolder, 'ticket.json');
	const syncPath = join(ticketFolder, 'ticket-sync.json');
	const publishedPath = join(ticketFolder, 'ticket.published.json');
	const seen: (TicketRecord | undefined)[] = [];
	const progress: string[] = [];
	// The row that changes the published copy mid-flight swaps this variable.
	let publishedText = published === undefined ? undefined : await canonicalTicketRecordText({ record: published });
	let reads = 0;
	const hooks: { onPublishedRead?: (params: { call: number }) => Promise<void> } = {};

	await updateLocalTicketRecord({ cwd, ticketBranch, change: () => local });

	const setSyncedHash = async ({ record }: { record: TicketRecord }) => {
		const hash = sha256({ content: await canonicalTicketRecordText({ record }) });

		writeFileSync(syncPath, `${JSON.stringify({ planMarkers: {}, recordSha256: hash, schemaVersion: 1 }, undefined, '\t')}\n`);
	};

	if (sidecarOf !== undefined) {
		await setSyncedHash({ record: sidecarOf });
	}

	if (sidecarUnwritable === true) {
		mkdirSync(syncPath, { recursive: true });
	}

	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' }]);
	mockGetTicketAttachments.mockImplementation(async () => {
		reads += 1;
		await hooks.onPublishedRead?.({ call: reads });

		return publishedText === undefined ? [] : [{ id: 'att-1', title: 'ticket.json', url: assetUrl }];
	});
	mockReadTicketAsset.mockImplementation(async () => publishedText ?? { error: 'no asset' });
	mockSetTicketAttachment.mockImplementation(async () => (uploadFailure === undefined ? undefined : { error: uploadFailure }));

	return {
		cwd,
		recordPath,
		syncPath,
		publishedPath,
		seen,
		progress,
		hooks,
		setSyncedHash,
		setPublished: ({ text }: { text: string }) => {
			publishedText = text;
		},
		params: {
			cwd,
			ticketBranch,
			config,
			env,
			change: (current: TicketRecord | undefined): TicketRecord | { error: string } => {
				seen.push(current);

				return refusal === undefined ? withEvent({ record: current ?? recordOf(), detail }) : { error: refusal };
			},
			onProgress: (message: string) => progress.push(message),
		},
	};
};

/** Every upload the tracker was asked for, as title, content type and the text sent. */
const attachedBy = () =>
	mockSetTicketAttachment.mock.calls.map(([call]) => ({ title: call.title, contentType: call.contentType, text: call.content.toString('utf8') }));

/** The hash `ticket-sync.json` holds, or undefined when there is no sidecar. */
const syncedHashAt = ({ syncPath }: { syncPath: string }) =>
	existsSync(syncPath) ? (JSON.parse(readFileSync(syncPath, 'utf8')) as { recordSha256?: string }).recordSha256 : undefined;

describe('updateSyncedTicketRecord', () => {
	test('updateSyncedTicketRecord: applies the change, publishes the serialized record as ticket.json and records its hash', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });

		const result = await updateSyncedTicketRecord(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toStrictEqual({ record: withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' }) });
		expect(attachedBy()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
	});

	test('updateSyncedTicketRecord: pulls a moved published record first so the change runs on it', async () => {
		const { params, seen } = await setupSyncedRecord({ published: movedPublished, sidecarOf: localRecord });

		await updateSyncedTicketRecord(params);

		expect(seen).toStrictEqual([movedPublished]);
	});

	test('updateSyncedTicketRecord: refuses on a divergence without running the change or publishing', async () => {
		const { params, seen, recordPath } = await setupSyncedRecord({ published: movedPublished });
		const before = readFileSync(recordPath, 'utf8');

		const result = await updateSyncedTicketRecord(params);

		expect(result).toEqual({ error: expect.stringContaining('lightsout work-order sync') });
		expect(seen).toStrictEqual([]);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('updateSyncedTicketRecord: keeps the local change and answers the publish failure when the tracker refuses ticket.json', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({
			published: localRecord,
			sidecarOf: localRecord,
			uploadFailure: 'the tracker rejected the attachment',
		});
		const changed = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

		const result = await updateSyncedTicketRecord(params);

		// The sentence has to carry the tracker's own reason, or a human is told the
		// publish failed without being told what refused it.
		expect(result).toEqual({ record: changed, publishError: expect.stringContaining('the tracker rejected the attachment') });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord).history).toStrictEqual(changed.history);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
	});

	test("updateSyncedTicketRecord: answers the change's own refusal and writes and publishes nothing", async () => {
		const { params, recordPath } = await setupSyncedRecord({
			published: localRecord,
			sidecarOf: localRecord,
			refusal: 'plan 002-queue-order is already excluded',
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await updateSyncedTicketRecord(params);

		expect(result).toStrictEqual({ error: 'plan 002-queue-order is already excluded' });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('updateSyncedTicketRecord: with no ticket-tracker block, changes the local record and publishes nothing', async () => {
		const { params, recordPath } = await setupSyncedRecord({ config: { gates } });
		const changed = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

		const result = await updateSyncedTicketRecord(params);

		expect(result).toStrictEqual({ record: changed });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord).history).toStrictEqual(changed.history);
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('updateSyncedTicketRecord: never overwrites a published record that moved after the pull', async () => {
		const { params, hooks, setPublished, recordPath, syncPath, publishedPath } = await setupSyncedRecord({
			published: localRecord,
			sidecarOf: localRecord,
		});
		const newerText = await canonicalTicketRecordText({ record: otherPublished });
		const changed = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

		// The second read of the ticket is the guarded upload's own re-read: another
		// machine published between this command's pull and its attach.
		hooks.onPublishedRead = async ({ call }) => {
			if (call > 1) {
				setPublished({ text: newerText });
			}
		};

		const result = await updateSyncedTicketRecord(params);

		expect(result).toEqual({ record: changed, publishError: expect.stringContaining('lightsout work-order sync') });
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord).history).toStrictEqual(changed.history);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
		expect(readFileSync(publishedPath, 'utf8')).toBe(newerText);
	});

	test("updateSyncedTicketRecord: never reports this machine's own concurrent publish as a divergence", async () => {
		const { params, hooks, setPublished, setSyncedHash, recordPath, syncPath, publishedPath } = await setupSyncedRecord({
			published: localRecord,
			sidecarOf: localRecord,
		});
		const ownText = await canonicalTicketRecordText({ record: otherPublished });

		// Another process on this machine published those bytes after the pull, so
		// the sidecar already names them: nothing of another machine's is at risk.
		hooks.onPublishedRead = async ({ call }) => {
			if (call > 1) {
				setPublished({ text: ownText });
				await setSyncedHash({ record: otherPublished });
			}
		};

		const result = await updateSyncedTicketRecord(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toStrictEqual({ record: withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' }) });
		expect(attachedBy()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
		expect(existsSync(publishedPath)).toBe(false);
	});

	test('updateSyncedTicketRecord: uploads the newest local record rather than the bytes it wrote', async () => {
		const { params, hooks, cwd, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });

		// A second command on this machine changes the record again after this one
		// released the lock and before the upload reads what to send.
		hooks.onPublishedRead = async ({ call }) => {
			if (call > 1) {
				await updateLocalTicketRecord({
					cwd,
					ticketBranch,
					change: (current) => ({
						...(current ?? localRecord),
						history: [...(current?.history ?? []), { at: '2026-03-01T00:00:00.000Z', kind: TicketEventKind.PlanRetitled, detail: 'retitled plan 001-record' }],
					}),
				});
			}
		};

		await updateSyncedTicketRecord(params);

		const written = readFileSync(recordPath, 'utf8');

		expect((JSON.parse(written) as TicketRecord).history.at(-1)?.detail).toBe('retitled plan 001-record');
		expect(attachedBy()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
	});

	test('updateSyncedTicketRecord: attaches when the ticket carries no published record at upload time', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ sidecarOf: localRecord });

		const result = await updateSyncedTicketRecord(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toStrictEqual({ record: withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' }) });
		expect(attachedBy()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
	});

	test('updateSyncedTicketRecord: keeps the change and answers a sidecar it could not write as a publish failure', async () => {
		const { params, recordPath } = await setupSyncedRecord({ sidecarUnwritable: true });
		const changed = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

		const result = await updateSyncedTicketRecord(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toEqual({ record: changed, publishError: expect.stringContaining('could not record that it was') });
		expect(attachedBy()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', text: written }]);
	});

	test('updateSyncedTicketRecord: answers the publish failure when the tracker cannot look the ticket up', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });
		const changed = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

		mockGetTicketsByIdentifiers.mockResolvedValue({ error: 'the tracker API answered 503' });

		const result = await updateSyncedTicketRecord(params);

		expect(result).toStrictEqual({ record: changed, publishError: 'the ticket record could not be published: the tracker API answered 503' });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord).history).toStrictEqual(changed.history);
		expect(attachedBy()).toStrictEqual([]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
	});

	test('updateSyncedTicketRecord: answers the publish failure when the configured tracker carries no such ticket', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });
		const changed = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

		mockGetTicketsByIdentifiers.mockResolvedValue([]);

		const result = await updateSyncedTicketRecord(params);

		expect(result).toStrictEqual({
			record: changed,
			publishError: 'the ticket record could not be published: there is no lo-140 on the configured ticket tracker',
		});
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord).history).toStrictEqual(changed.history);
		expect(attachedBy()).toStrictEqual([]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
	});

	test("updateSyncedTicketRecord: the synced write lands in the ticket's own folder", async () => {
		const { params, cwd, recordPath, syncPath } = await setupSyncedRecord();
		const changed = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

		const result = await updateSyncedTicketRecord(params);

		const written = readFileSync(recordPath, 'utf8');

		// One folder answers all three: the record written through, the sidecar that
		// names what was published, and the bytes the tracker was sent.
		expect(result).toStrictEqual({ record: changed });
		expect((JSON.parse(written) as TicketRecord).history).toStrictEqual(changed.history);
		expect(attachedBy()).toStrictEqual([{ title: 'ticket.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
		expect(existsSync(join(cwd, '.lightsout', 'plans'))).toBe(false);
	});
});
