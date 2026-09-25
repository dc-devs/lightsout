import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import { updateSyncedWorkOrderState } from '#src/workOrder/updateSyncedWorkOrderState.ts';
import { canonicalTicketRecordText } from '#tests/helpers/canonicalTicketRecordText.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

/**
 * What a synced update answers when the local change lands but the publish does
 * not.
 *
 * A sibling of `updateSyncedWorkOrderState.unit.test.ts` rather than more cases
 * in it: that file states what the update writes and publishes on the paths
 * that work, while every case here is about the local record being kept and the
 * tracker's own failure being handed back rather than swallowed.
 */

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

/** The record every row here starts from. */
const localRecord = recordOf({ details: ['added plan 001-record'] });
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
			publishError: 'the work order state could not be published: there is no LO-140 on the configured ticket tracker',
		});
		expect((JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState).history).toStrictEqual(changedRecord.history);
		expect(attachedBy()).toStrictEqual([]);
		expect(syncedHashAt({ syncPath })).toBe(sha256({ content: await canonicalTicketRecordText({ record: localRecord }) }));
	});
});
