import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type LightsoutConfig, WorkOrderEventKind, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { updateLocalWorkOrderState, updateSyncedWorkOrderState } from '#src/workOrder/index.ts';
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

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';
const assetUrl = 'https://assets.example.com/state.json';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };

/** A record the contract accepts, carrying one history event per detail given. */
const recordOf = ({ details = [] }: { details?: string[] } = {}): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history: details.map((detail, index) => ({ at: `2026-01-0${index + 1}T00:00:00.000Z`, kind: WorkOrderEventKind.PlanAdded, detail })),
});

const withEvent = ({ record, detail }: { record: WorkOrderState; detail: string }): WorkOrderState => ({
	...record,
	history: [...record.history, { at: '2026-02-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail }],
});

/** The record the rows start from, the copy a moved ticket carries, and the copy a second machine publishes. */
const localRecord = recordOf({ details: ['added plan 001-record'] });
const movedPublished = recordOf({ details: ['added plan 001-record', 'added plan 002-queue-order'] });
const otherPublished = recordOf({ details: ['added plan 001-record', 'added plan 004-elsewhere'] });
/** What the change appends to the local record, which is what every row below expects back. */
const changedRecord = withEvent({ record: localRecord, detail: 'added plan 003-ship-guard' });

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
	local?: WorkOrderState;
	/** The record the ticket carries, or nothing published at all. */
	published?: WorkOrderState;
	/** The record whose hash `state-sync.json` holds, or no sidecar at all. */
	sidecarOf?: WorkOrderState;
	config?: LightsoutConfig;
	/** The sentence the tracker refuses the upload with. */
	uploadFailure?: string;
	/** The history detail the change appends. */
	detail?: string;
	/** When set, the change refuses with this sentence instead of appending. */
	refusal?: string;
	/** Puts a directory where `state-sync.json` belongs, so every write of the sidecar fails the way a full or read-only disk would. */
	sidecarUnwritable?: boolean;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-synced-record-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const recordPath = join(workOrderFolder, 'state.json');
	const syncPath = join(workOrderFolder, 'state-sync.json');
	const publishedPath = join(workOrderFolder, 'state.published.json');
	const seen: (WorkOrderState | undefined)[] = [];
	const progress: string[] = [];
	// The row that changes the published copy mid-flight swaps this variable.
	let publishedText = published === undefined ? undefined : await canonicalTicketRecordText({ record: published });
	let reads = 0;
	const hooks: { onPublishedRead?: (params: { call: number }) => Promise<void> } = {};

	await updateLocalWorkOrderState({ cwd, name, change: () => local });

	const setSyncedHash = async ({ record }: { record: WorkOrderState }) => {
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

		return publishedText === undefined ? [] : [{ id: 'att-1', title: 'state.json', url: assetUrl }];
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
			name,
			config,
			env,
			change: (current: WorkOrderState | undefined): WorkOrderState | { error: string } => {
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

/** The hash `state-sync.json` holds, or undefined when there is no sidecar. */
const syncedHashAt = ({ syncPath }: { syncPath: string }) =>
	existsSync(syncPath) ? (JSON.parse(readFileSync(syncPath, 'utf8')) as { recordSha256?: string }).recordSha256 : undefined;

describe('updateSyncedWorkOrderState', () => {
	test('updateSyncedWorkOrderState: applies the change, publishes the serialized record as state.json and records its hash', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });

		const result = await updateSyncedWorkOrderState(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toStrictEqual({ record: changedRecord });
		expect(attachedBy()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
	});

	test('updateSyncedWorkOrderState: pulls a moved published record first so the change runs on it', async () => {
		const { params, seen } = await setupSyncedRecord({ published: movedPublished, sidecarOf: localRecord });

		await updateSyncedWorkOrderState(params);

		expect(seen).toStrictEqual([movedPublished]);
	});

	test('updateSyncedWorkOrderState: refuses on a divergence without running the change or publishing', async () => {
		const { params, seen, recordPath } = await setupSyncedRecord({ published: movedPublished });
		const before = readFileSync(recordPath, 'utf8');

		const result = await updateSyncedWorkOrderState(params);

		expect(result).toEqual({ error: expect.stringContaining('lightsout work-order sync') });
		expect(seen).toStrictEqual([]);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('updateSyncedWorkOrderState: keeps the local change and answers the publish failure when the tracker refuses state.json', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({
			published: localRecord,
			sidecarOf: localRecord,
			uploadFailure: 'the tracker rejected the attachment',
		});

		const result = await updateSyncedWorkOrderState(params);

		// The sentence has to carry the tracker's own reason, or a human is told the
		// publish failed without being told what refused it.
		expect(result).toEqual({ record: changedRecord, publishError: expect.stringContaining('the tracker rejected the attachment') });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState).history).toStrictEqual(changedRecord.history);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
	});

	test("updateSyncedWorkOrderState: answers the change's own refusal and writes and publishes nothing", async () => {
		const { params, recordPath } = await setupSyncedRecord({
			published: localRecord,
			sidecarOf: localRecord,
			refusal: 'plan 002-queue-order is already excluded',
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await updateSyncedWorkOrderState(params);

		expect(result).toStrictEqual({ error: 'plan 002-queue-order is already excluded' });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('updateSyncedWorkOrderState: with no ticket-tracker block, changes the local record and publishes nothing', async () => {
		const { params, recordPath } = await setupSyncedRecord({ config: { gates } });

		const result = await updateSyncedWorkOrderState(params);

		expect(result).toStrictEqual({ record: changedRecord });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState).history).toStrictEqual(changedRecord.history);
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('updateSyncedWorkOrderState: never overwrites a published record that moved after the pull', async () => {
		const { params, hooks, setPublished, recordPath, syncPath, publishedPath } = await setupSyncedRecord({
			published: localRecord,
			sidecarOf: localRecord,
		});
		const newerText = await canonicalTicketRecordText({ record: otherPublished });

		// The second read of the ticket is the guarded upload's own re-read: another
		// machine published between this command's pull and its attach.
		hooks.onPublishedRead = async ({ call }) => {
			if (call > 1) {
				setPublished({ text: newerText });
			}
		};

		const result = await updateSyncedWorkOrderState(params);

		expect(result).toEqual({ record: changedRecord, publishError: expect.stringContaining('lightsout work-order sync') });
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState).history).toStrictEqual(changedRecord.history);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
		expect(readFileSync(publishedPath, 'utf8')).toBe(newerText);
	});

	test("updateSyncedWorkOrderState: never reports this machine's own concurrent publish as a divergence", async () => {
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

		const result = await updateSyncedWorkOrderState(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toStrictEqual({ record: changedRecord });
		expect(attachedBy()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
		expect(existsSync(publishedPath)).toBe(false);
	});

	test('updateSyncedWorkOrderState: uploads the newest local record rather than the bytes it wrote', async () => {
		const { params, hooks, cwd, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });

		// A second command on this machine changes the record again after this one
		// released the lock and before the upload reads what to send.
		hooks.onPublishedRead = async ({ call }) => {
			if (call > 1) {
				const retitled = { at: '2026-03-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanRetitled, detail: 'retitled plan 001-record' };

				await updateLocalWorkOrderState({
					cwd,
					name,
					change: (current) => ({ ...(current ?? localRecord), history: [...(current?.history ?? []), retitled] }),
				});
			}
		};

		await updateSyncedWorkOrderState(params);

		const written = readFileSync(recordPath, 'utf8');

		expect((JSON.parse(written) as WorkOrderState).history.at(-1)?.detail).toBe('retitled plan 001-record');
		expect(attachedBy()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
	});

	test('updateSyncedWorkOrderState: attaches when the ticket carries no published record at upload time', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ sidecarOf: localRecord });

		const result = await updateSyncedWorkOrderState(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toStrictEqual({ record: changedRecord });
		expect(attachedBy()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
	});

	test('updateSyncedWorkOrderState: keeps the change and answers a sidecar it could not write as a publish failure', async () => {
		const { params, recordPath } = await setupSyncedRecord({ sidecarUnwritable: true });

		const result = await updateSyncedWorkOrderState(params);

		const written = readFileSync(recordPath, 'utf8');

		expect(result).toEqual({ record: changedRecord, publishError: expect.stringContaining('could not record that it was') });
		expect(attachedBy()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', text: written }]);
	});

	test('updateSyncedWorkOrderState: answers the publish failure when the tracker cannot look the ticket up', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });

		mockGetTicketsByIdentifiers.mockResolvedValue({ error: 'the tracker API answered 503' });

		const result = await updateSyncedWorkOrderState(params);

		expect(result).toStrictEqual({ record: changedRecord, publishError: 'the work order state could not be published: the tracker API answered 503' });
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState).history).toStrictEqual(changedRecord.history);
		expect(attachedBy()).toStrictEqual([]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
	});

	test('updateSyncedWorkOrderState: answers the publish failure when the configured tracker carries no such ticket', async () => {
		const { params, recordPath, syncPath } = await setupSyncedRecord({ published: localRecord, sidecarOf: localRecord });

		mockGetTicketsByIdentifiers.mockResolvedValue([]);

		const result = await updateSyncedWorkOrderState(params);

		expect(result).toStrictEqual({
			record: changedRecord,
			publishError: 'the work order state could not be published: there is no lo-140 on the configured ticket tracker',
		});
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState).history).toStrictEqual(changedRecord.history);
		expect(attachedBy()).toStrictEqual([]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
	});

	test("updateSyncedWorkOrderState: the synced write lands in the ticket's own folder", async () => {
		const { params, cwd, recordPath, syncPath } = await setupSyncedRecord();

		const result = await updateSyncedWorkOrderState(params);

		const written = readFileSync(recordPath, 'utf8');

		// One folder answers all three: the record written through, the sidecar that
		// names what was published, and the bytes the tracker was sent.
		expect(result).toStrictEqual({ record: changedRecord });
		expect((JSON.parse(written) as WorkOrderState).history).toStrictEqual(changedRecord.history);
		expect(attachedBy()).toStrictEqual([{ title: 'state.json', contentType: 'application/json', text: written }]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: written }));
		expect(existsSync(join(cwd, '.lightsout', 'plans'))).toBe(false);
	});
});
