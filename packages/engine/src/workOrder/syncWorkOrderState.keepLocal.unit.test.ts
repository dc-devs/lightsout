import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { WorkOrderSyncKeep } from '#src/workOrder/common/constants/WorkOrderSyncKeep.ts';
import { syncWorkOrderState } from '#src/workOrder/syncWorkOrderState.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the seam this file keeps: replacing it is what lets a
// resolved divergence be asserted end to end without a network. The ticket
// folder, the record, the sidecar and the plan folders are real files in a
// temporary checkout, because which copy a keep choice acts on is a disk read.
type TrackerFailure = { error: string };
type TrackerTicket = { id: string; identifier: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { settings: unknown; ticketId: string; title: string; content: Buffer; contentType: string };

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
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }) =>
		config['ticket-tracker'] === undefined
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: env.LINEAR_API_KEY ?? '' },
}));
jest.mock('#src/ticketTracker/setTicketAttachment.ts', () => ({ setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params) }));
// -------------------------
// Only the plan publish is replaced. The plan module's other exports stay real,
// so the plan folder a republish is decided on is looked up on disk exactly as
// it is in a run.
interface PublishParams {
	cwd: string;
	name: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
	titlePrefix?: string;
}

interface PublishReport {
	ticketRef?: string;
	published: string[];
	stale: string[];
	error?: string;
	markerSha256?: string;
}

const mockPublishPlan = jest.fn<(params: PublishParams) => Promise<PublishReport>>();

jest.mock('#src/plan/publish/publishPlan.ts', () => ({ publishPlan: (params: PublishParams) => mockPublishPlan(params) }));
// -------------------------

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';
const ticketRef = 'LO-140';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const config: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };
const env = { LINEAR_API_KEY: 'lin_key' };
/** The first event of every record here, so a carried plan's event is the last one. */
const firstEvent = { at: '2026-09-01T09:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added plan 001-ticket-record' };

type SyncResult = { record: WorkOrderState } | { error: string };
type SyncState = { schemaVersion: 1; recordSha256?: string; planMarkers: Record<string, string> };

/** A hash of the right shape for a field the contract reads as a SHA-256, told apart by what it was made from. */
const digestOf = ({ seed }: { seed: string }) => createHash('sha256').update(seed).digest('hex');

const planOf = ({ id, title = `Plan ${id}`, publishedMarker }: { id: string; title?: string; publishedMarker?: string }): WorkOrderState['plans'][number] => ({
	id,
	title,
	progress: PlanProgress.Ready,
	createdAt: '2026-09-01T09:00:00.000Z',
	...(publishedMarker === undefined ? {} : { publishedMarker }),
});

const recordOf = ({ plans, history = [firstEvent] }: { plans: WorkOrderState['plans']; history?: WorkOrderState['history'] }): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef,
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans,
	history,
});

const asFileText = ({ value }: { value: unknown }) => `${JSON.stringify(value, undefined, '\t')}\n`;

interface SetupParams {
	/** The record in the primary checkout's work order folder. Absent writes no `state.json`. */
	local?: WorkOrderState;
	/** The record the ticket carries. Absent leaves the ticket with no `state.json` attachment. */
	published?: WorkOrderState;
	/** What every read of the ticket after the first answers, for a record another machine publishes mid-command. */
	publishedAfterFirstRead?: WorkOrderState;
	/** The sidecar naming the bytes this machine last published or restored. */
	syncState?: SyncState;
	/** Plan folders that exist in the primary checkout's work order folder. */
	planFolders?: string[];
	/** The marker hash a republish of a plan folder reports. */
	republishedMarker?: string;
	/** Whether an earlier divergence left its published copy beside the record. */
	publishedCopyOnDisk?: boolean;
}

/**
 * A checkout outside any repository, so the shared state directory is its own
 * `.lightsout` and the work order folder is a path the test can name, with the
 * ticket's side of the story scripted on the tracker mocks.
 */
const setupSync = ({
	local,
	published,
	publishedAfterFirstRead,
	syncState,
	planFolders = [],
	republishedMarker = digestOf({ seed: 'a republished marker' }),
	publishedCopyOnDisk = false,
}: SetupParams) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-sync-keep-local-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const progress: string[] = [];
	const bodies = [published, publishedAfterFirstRead ?? published].map((record) => (record === undefined ? undefined : asFileText({ value: record })));
	let reads = 0;

	mkdirSync(workOrderFolder, { recursive: true });

	if (local !== undefined) {
		writeFileSync(join(workOrderFolder, 'state.json'), asFileText({ value: local }));
	}

	if (syncState !== undefined) {
		writeFileSync(join(workOrderFolder, 'state-sync.json'), asFileText({ value: syncState }));
	}

	if (publishedCopyOnDisk && published !== undefined) {
		writeFileSync(join(workOrderFolder, 'state.published.json'), asFileText({ value: published }));
	}

	for (const planId of planFolders) {
		mkdirSync(join(workOrderFolder, 'plans', planId), { recursive: true });
		writeFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), `# ${planId}\n`);
	}

	mockGetTicketAttachments.mockResolvedValue(
		published === undefined ? [] : [{ id: 'att-record', title: 'state.json', url: 'https://assets.example/ticket-record' }],
	);
	mockReadTicketAsset.mockImplementation(async () => {
		const body = bodies[Math.min(reads, bodies.length - 1)];

		reads += 1;

		return body ?? { error: 'the ticket carries no state.json' };
	});
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: ticketRef }]);
	mockSetTicketAttachment.mockResolvedValue(undefined);
	mockPublishPlan.mockResolvedValue({ ticketRef, published: ['003-held-here--plan.md'], stale: [], markerSha256: republishedMarker });

	return { cwd, workOrderFolder, progress, params: { cwd, name, config, env, onProgress: (message: string) => progress.push(message) } };
};

const recordFrom = ({ result }: { result: SyncResult }) => ('record' in result ? result.record : undefined);
const errorFrom = ({ result }: { result: SyncResult }) => ('error' in result ? result.error : undefined);

/** The record as it stands in the primary checkout's work order folder. */
const localRecordOf = ({ workOrderFolder }: { workOrderFolder: string }): unknown => JSON.parse(readFileSync(join(workOrderFolder, 'state.json'), 'utf8'));

const syncStateOf = ({ workOrderFolder }: { workOrderFolder: string }) =>
	JSON.parse(readFileSync(join(workOrderFolder, 'state-sync.json'), 'utf8')) as SyncState;

/** Every upload of the work order state itself, in the order they were sent. */
const recordWrites = () => mockSetTicketAttachment.mock.calls.map(([write]) => write).filter((write) => write.title === 'state.json');

/** The abandoned pre-layout record of this same ticket, whose plan carries a title nothing should ever publish and no folder on disk. */
const prelayoutRecord = recordOf({ plans: [planOf({ id: '003-held-here', title: 'The title in the pre-layout folder' })] });

/**
 * The sync `setupSync` arranges, with `prelayoutRecord` left in the pre-layout
 * folder: a sync reading there would publish its title and republish nothing.
 */
const setupTicketFolderSync = ({ republishedMarker }: { republishedMarker: string }) => {
	const base = setupSync({
		local: recordOf({ plans: [planOf({ id: '003-held-here', title: 'The title in the work order folder' })] }),
		published: recordOf({
			plans: [planOf({ id: '003-held-here', title: 'The title the ticket carries', publishedMarker: digestOf({ seed: '003 as the ticket carries it' }) })],
		}),
		syncState: { schemaVersion: 1, planMarkers: {} },
		planFolders: ['003-held-here'],
		republishedMarker,
	});
	const prelayoutFolder = join(base.cwd, '.lightsout', 'plans', name);

	mkdirSync(prelayoutFolder, { recursive: true });
	writeFileSync(join(prelayoutFolder, 'state.json'), asFileText({ value: prelayoutRecord }));

	return { ...base, prelayoutFolder };
};

describe('syncWorkOrderState', () => {
	test('syncWorkOrderState: both keep choices carry a plan only one copy holds so no number is lost or reused', async () => {
		const keepingPublished = setupSync({
			local: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '003-queue-order' })] }),
			published: recordOf({ plans: [planOf({ id: '001-ticket-record' })] }),
		});

		const published = await syncWorkOrderState({ ...keepingPublished.params, keep: WorkOrderSyncKeep.Published });

		const keepingLocal = setupSync({
			local: recordOf({ plans: [planOf({ id: '001-ticket-record' })] }),
			published: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '004-ship-guard' })] }),
		});

		const local = await syncWorkOrderState({ ...keepingLocal.params, keep: WorkOrderSyncKeep.Local });

		const carriedFromLocal = recordFrom({ result: published })?.history.at(-1);
		const carriedFromPublished = recordFrom({ result: local })?.history.at(-1);

		expect(recordFrom({ result: published })?.plans.map((plan) => plan.id)).toStrictEqual(['001-ticket-record', '003-queue-order']);
		expect(carriedFromLocal).toStrictEqual({ at: expect.any(String), kind: 'plan-added', detail: expect.stringContaining('003-queue-order') });
		expect(carriedFromLocal?.detail).toContain('local');
		expect(recordFrom({ result: local })?.plans.map((plan) => plan.id)).toStrictEqual(['001-ticket-record', '004-ship-guard']);
		expect(carriedFromPublished).toStrictEqual({ at: expect.any(String), kind: 'plan-added', detail: expect.stringContaining('004-ship-guard') });
		expect(carriedFromPublished?.detail).toContain('published');
	});

	test('syncWorkOrderState: refuses a keep choice when the two copies used one number for different plans', async () => {
		const clash = {
			local: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '003-queue-order' })] }),
			published: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '003-ship-request' })] }),
		};
		const keepingPublished = setupSync(clash);

		const published = await syncWorkOrderState({ ...keepingPublished.params, keep: WorkOrderSyncKeep.Published });

		const keepingLocal = setupSync(clash);

		const local = await syncWorkOrderState({ ...keepingLocal.params, keep: WorkOrderSyncKeep.Local });

		expect(errorFrom({ result: published })).toContain('003-queue-order');
		expect(errorFrom({ result: published })).toContain('003-ship-request');
		expect(errorFrom({ result: local })).toContain('003-queue-order');
		expect(errorFrom({ result: local })).toContain('003-ship-request');
		expect(localRecordOf({ workOrderFolder: keepingPublished.workOrderFolder })).toStrictEqual(clash.local);
		expect(localRecordOf({ workOrderFolder: keepingLocal.workOrderFolder })).toStrictEqual(clash.local);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('syncWorkOrderState: keeping the local copy publishes it over the published one, records its hash and removes state.published.json', async () => {
		const local = recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title this machine holds' })] });
		const { params, workOrderFolder } = setupSync({
			local,
			published: recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title another machine published' })] }),
			syncState: { schemaVersion: 1, recordSha256: digestOf({ seed: 'the bytes this machine last published' }), planMarkers: {} },
			publishedCopyOnDisk: true,
		});

		const result = await syncWorkOrderState({ ...params, keep: WorkOrderSyncKeep.Local });

		const [attached] = recordWrites();

		expect(result).toStrictEqual({ record: local });
		expect(attached).toStrictEqual({
			settings: expect.objectContaining({ provider: 'linear' }),
			ticketId: 'id-140',
			title: 'state.json',
			content: expect.any(Buffer),
			contentType: 'application/json',
		});
		expect(JSON.parse(attached?.content.toString('utf8') ?? 'null')).toStrictEqual(local);
		expect(syncStateOf({ workOrderFolder }).recordSha256).toBe(
			createHash('sha256')
				.update(attached?.content ?? Buffer.alloc(0))
				.digest('hex'),
		);
		expect(existsSync(join(workOrderFolder, 'state.published.json'))).toBe(false);
	});

	test('syncWorkOrderState: keeping the local copy republishes a divergent plan held locally and adopts the published marker for one it does not hold', async () => {
		const heldMarker = digestOf({ seed: '003 as the ticket carries it' });
		const elsewhereMarker = digestOf({ seed: '004 as the ticket carries it' });
		const republishedMarker = digestOf({ seed: '003 as this machine has just published it' });
		const { params, cwd, workOrderFolder } = setupSync({
			local: recordOf({ plans: [planOf({ id: '003-held-here' }), planOf({ id: '004-held-elsewhere' })] }),
			published: recordOf({
				plans: [planOf({ id: '003-held-here', publishedMarker: heldMarker }), planOf({ id: '004-held-elsewhere', publishedMarker: elsewhereMarker })],
			}),
			syncState: { schemaVersion: 1, planMarkers: {} },
			planFolders: ['003-held-here'],
			republishedMarker,
		});

		const result = await syncWorkOrderState({ ...params, keep: WorkOrderSyncKeep.Local });

		expect(mockPublishPlan).toHaveBeenCalledTimes(1);
		expect(mockPublishPlan).toHaveBeenCalledWith(expect.objectContaining({ cwd, name: 'lo-140-multi/003-held-here', titlePrefix: '003-held-here' }));
		expect(recordFrom({ result })?.plans).toEqual([
			expect.objectContaining({ id: '003-held-here', publishedMarker: republishedMarker }),
			expect.objectContaining({ id: '004-held-elsewhere', publishedMarker: elsewhereMarker }),
		]);
		expect(syncStateOf({ workOrderFolder }).planMarkers['003-held-here']).toBe(republishedMarker);
	});

	test('syncWorkOrderState: keeping the local copy publishes it as the first copy when the ticket carries none', async () => {
		const local = recordOf({ plans: [planOf({ id: '001-ticket-record' })] });
		const { params, workOrderFolder } = setupSync({ local, syncState: { schemaVersion: 1, planMarkers: {} } });

		const result = await syncWorkOrderState({ ...params, keep: WorkOrderSyncKeep.Local });

		const [attached] = recordWrites();

		expect(result).toStrictEqual({ record: local });
		expect(JSON.parse(attached?.content.toString('utf8') ?? 'null')).toStrictEqual(local);
		expect(mockPublishPlan).not.toHaveBeenCalled();
		expect(syncStateOf({ workOrderFolder }).recordSha256).toBe(
			createHash('sha256')
				.update(attached?.content ?? Buffer.alloc(0))
				.digest('hex'),
		);
	});

	test('syncWorkOrderState: keeping the local copy leaves the work order state alone when a divergent plan cannot be republished', async () => {
		const { params, workOrderFolder } = setupSync({
			local: recordOf({ plans: [planOf({ id: '003-held-here' })] }),
			published: recordOf({ plans: [planOf({ id: '003-held-here', publishedMarker: digestOf({ seed: '003 as the ticket carries it' }) })] }),
			syncState: { schemaVersion: 1, planMarkers: {} },
			planFolders: ['003-held-here'],
		});

		mockPublishPlan.mockResolvedValue({ published: [], stale: [], error: 'the tracker refused 003-held-here--plan.md' });

		const result = await syncWorkOrderState({ ...params, keep: WorkOrderSyncKeep.Local });

		expect(errorFrom({ result })).toContain('the tracker refused 003-held-here--plan.md');
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(syncStateOf({ workOrderFolder }).recordSha256).toBeUndefined();
	});

	test('syncWorkOrderState: keeping the local copy refuses when there is no local record', async () => {
		const { params, workOrderFolder } = setupSync({ published: recordOf({ plans: [planOf({ id: '001-ticket-record' })] }) });

		const result = await syncWorkOrderState({ ...params, keep: WorkOrderSyncKeep.Local });

		// The sentence has to name the ticket whose record is missing, so a human
		// reading it knows which branch to sync the other way instead.
		expect(result).toStrictEqual({ error: expect.stringContaining(name) });
		expect(errorFrom({ result })).toContain('state.json');
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(existsSync(join(workOrderFolder, 'state.json'))).toBe(false);
	});

	test('syncWorkOrderState: keeping the local copy never overwrites a published record newer than the one it read', async () => {
		const local = recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title this machine holds' })] });
		const { params, workOrderFolder } = setupSync({
			local,
			published: recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title this command read' })] }),
			publishedAfterFirstRead: recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title another machine published next' })] }),
			syncState: { schemaVersion: 1, recordSha256: digestOf({ seed: 'the bytes this machine last published' }), planMarkers: {} },
		});

		const result = await syncWorkOrderState({ ...params, keep: WorkOrderSyncKeep.Local });

		expect(errorFrom({ result })).toContain('lightsout work-order sync');
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(localRecordOf({ workOrderFolder })).toStrictEqual(local);
	});

	test("syncWorkOrderState: a keep-local sync works entirely inside the ticket's own folder", async () => {
		const republishedMarker = digestOf({ seed: '003 as the work order folder has just published it' });
		const { workOrderFolder, prelayoutFolder, params } = setupTicketFolderSync({ republishedMarker });

		const result = await syncWorkOrderState({ ...params, keep: WorkOrderSyncKeep.Local });

		const [attached] = recordWrites();
		const kept = recordOf({ plans: [planOf({ id: '003-held-here', title: 'The title in the work order folder', publishedMarker: republishedMarker })] });

		expect(result).toStrictEqual({ record: kept });
		expect(JSON.parse(attached?.content.toString('utf8') ?? 'null')).toStrictEqual(kept);
		expect(mockPublishPlan).toHaveBeenCalledWith(expect.objectContaining({ name: 'lo-140-multi/003-held-here', titlePrefix: '003-held-here' }));
		expect(localRecordOf({ workOrderFolder })).toStrictEqual(kept);
		expect(syncStateOf({ workOrderFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: createHash('sha256')
				.update(attached?.content ?? Buffer.alloc(0))
				.digest('hex'),
			planMarkers: { '003-held-here': republishedMarker },
		});
		expect(JSON.parse(readFileSync(join(prelayoutFolder, 'state.json'), 'utf8'))).toStrictEqual(prelayoutRecord);
	});
});
