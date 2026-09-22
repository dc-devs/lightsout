import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, WorkOrderEventKind, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import { syncTicketRecord, TicketSyncKeep } from '#src/ticket/index.ts';
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

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }) =>
		config['ticket-tracker'] === undefined
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: env.LINEAR_API_KEY ?? '' },
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
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

jest.mock('#src/plan/index.ts', () => ({
	...jest.requireActual<typeof import('#src/plan/index.ts')>('#src/plan/index.ts'),
	publishPlan: (params: PublishParams) => mockPublishPlan(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';
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
	ticketRef,
	branch: ticketBranch,
	mode: WorkOrderMode.MultiplePlan,
	plans,
	history,
});

const asFileText = ({ value }: { value: unknown }) => `${JSON.stringify(value, undefined, '\t')}\n`;

interface SetupParams {
	/** The record in the primary checkout's ticket folder. Absent writes no `ticket.json`. */
	local?: WorkOrderState;
	/** The record the ticket carries. Absent leaves the ticket with no `ticket.json` attachment. */
	published?: WorkOrderState;
	/** What every read of the ticket after the first answers, for a record another machine publishes mid-command. */
	publishedAfterFirstRead?: WorkOrderState;
	/** The sidecar naming the bytes this machine last published or restored. */
	syncState?: SyncState;
	/** Plan folders that exist in the primary checkout's ticket folder. */
	planFolders?: string[];
	/** The marker hash a republish of a plan folder reports. */
	republishedMarker?: string;
	/** Whether an earlier divergence left its published copy beside the record. */
	publishedCopyOnDisk?: boolean;
}

/**
 * A checkout outside any repository, so the shared state directory is its own
 * `.lightsout` and the ticket folder is a path the test can name, with the
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
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);
	const progress: string[] = [];
	const bodies = [published, publishedAfterFirstRead ?? published].map((record) => (record === undefined ? undefined : asFileText({ value: record })));
	let reads = 0;

	mkdirSync(ticketFolder, { recursive: true });

	if (local !== undefined) {
		writeFileSync(join(ticketFolder, 'ticket.json'), asFileText({ value: local }));
	}

	if (syncState !== undefined) {
		writeFileSync(join(ticketFolder, 'ticket-sync.json'), asFileText({ value: syncState }));
	}

	if (publishedCopyOnDisk && published !== undefined) {
		writeFileSync(join(ticketFolder, 'ticket.published.json'), asFileText({ value: published }));
	}

	for (const planId of planFolders) {
		mkdirSync(join(ticketFolder, 'plans', planId), { recursive: true });
		writeFileSync(join(ticketFolder, 'plans', planId, 'plan.md'), `# ${planId}\n`);
	}

	mockGetTicketAttachments.mockResolvedValue(
		published === undefined ? [] : [{ id: 'att-record', title: 'ticket.json', url: 'https://assets.example/ticket-record' }],
	);
	mockReadTicketAsset.mockImplementation(async () => {
		const body = bodies[Math.min(reads, bodies.length - 1)];

		reads += 1;

		return body ?? { error: 'the ticket carries no ticket.json' };
	});
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: ticketRef }]);
	mockSetTicketAttachment.mockResolvedValue(undefined);
	mockPublishPlan.mockResolvedValue({ ticketRef, published: ['003-held-here--plan.md'], stale: [], markerSha256: republishedMarker });

	return { cwd, ticketFolder, progress, params: { cwd, ticketBranch, config, env, onProgress: (message: string) => progress.push(message) } };
};

const recordFrom = ({ result }: { result: SyncResult }) => ('record' in result ? result.record : undefined);
const errorFrom = ({ result }: { result: SyncResult }) => ('error' in result ? result.error : undefined);

/** The record as it stands in the primary checkout's ticket folder. */
const localRecordOf = ({ ticketFolder }: { ticketFolder: string }): unknown => JSON.parse(readFileSync(join(ticketFolder, 'ticket.json'), 'utf8'));

const syncStateOf = ({ ticketFolder }: { ticketFolder: string }) => JSON.parse(readFileSync(join(ticketFolder, 'ticket-sync.json'), 'utf8')) as SyncState;

/** Every upload of the ticket record itself, in the order they were sent. */
const recordWrites = () => mockSetTicketAttachment.mock.calls.map(([write]) => write).filter((write) => write.title === 'ticket.json');

/** The abandoned pre-layout record of this same ticket, whose plan carries a title nothing should ever publish and no folder on disk. */
const prelayoutRecord = recordOf({ plans: [planOf({ id: '003-held-here', title: 'The title in the pre-layout folder' })] });

/**
 * The sync `setupSync` arranges, with `prelayoutRecord` left in the pre-layout
 * folder: a sync reading there would publish its title and republish nothing.
 */
const setupTicketFolderSync = ({ republishedMarker }: { republishedMarker: string }) => {
	const base = setupSync({
		local: recordOf({ plans: [planOf({ id: '003-held-here', title: 'The title in the ticket folder' })] }),
		published: recordOf({
			plans: [planOf({ id: '003-held-here', title: 'The title the ticket carries', publishedMarker: digestOf({ seed: '003 as the ticket carries it' }) })],
		}),
		syncState: { schemaVersion: 1, planMarkers: {} },
		planFolders: ['003-held-here'],
		republishedMarker,
	});
	const prelayoutFolder = join(base.cwd, '.lightsout', 'plans', ticketBranch);

	mkdirSync(prelayoutFolder, { recursive: true });
	writeFileSync(join(prelayoutFolder, 'ticket.json'), asFileText({ value: prelayoutRecord }));

	return { ...base, prelayoutFolder };
};

describe('syncTicketRecord', () => {
	test('syncTicketRecord: both keep choices carry a plan only one copy holds so no number is lost or reused', async () => {
		const keepingPublished = setupSync({
			local: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '003-queue-order' })] }),
			published: recordOf({ plans: [planOf({ id: '001-ticket-record' })] }),
		});

		const published = await syncTicketRecord({ ...keepingPublished.params, keep: TicketSyncKeep.Published });

		const keepingLocal = setupSync({
			local: recordOf({ plans: [planOf({ id: '001-ticket-record' })] }),
			published: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '004-ship-guard' })] }),
		});

		const local = await syncTicketRecord({ ...keepingLocal.params, keep: TicketSyncKeep.Local });

		const carriedFromLocal = recordFrom({ result: published })?.history.at(-1);
		const carriedFromPublished = recordFrom({ result: local })?.history.at(-1);

		expect(recordFrom({ result: published })?.plans.map((plan) => plan.id)).toStrictEqual(['001-ticket-record', '003-queue-order']);
		expect(carriedFromLocal).toStrictEqual({ at: expect.any(String), kind: 'plan-added', detail: expect.stringContaining('003-queue-order') });
		expect(carriedFromLocal?.detail).toContain('local');
		expect(recordFrom({ result: local })?.plans.map((plan) => plan.id)).toStrictEqual(['001-ticket-record', '004-ship-guard']);
		expect(carriedFromPublished).toStrictEqual({ at: expect.any(String), kind: 'plan-added', detail: expect.stringContaining('004-ship-guard') });
		expect(carriedFromPublished?.detail).toContain('published');
	});

	test('syncTicketRecord: refuses a keep choice when the two copies used one number for different plans', async () => {
		const clash = {
			local: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '003-queue-order' })] }),
			published: recordOf({ plans: [planOf({ id: '001-ticket-record' }), planOf({ id: '003-ship-request' })] }),
		};
		const keepingPublished = setupSync(clash);

		const published = await syncTicketRecord({ ...keepingPublished.params, keep: TicketSyncKeep.Published });

		const keepingLocal = setupSync(clash);

		const local = await syncTicketRecord({ ...keepingLocal.params, keep: TicketSyncKeep.Local });

		expect(errorFrom({ result: published })).toContain('003-queue-order');
		expect(errorFrom({ result: published })).toContain('003-ship-request');
		expect(errorFrom({ result: local })).toContain('003-queue-order');
		expect(errorFrom({ result: local })).toContain('003-ship-request');
		expect(localRecordOf({ ticketFolder: keepingPublished.ticketFolder })).toStrictEqual(clash.local);
		expect(localRecordOf({ ticketFolder: keepingLocal.ticketFolder })).toStrictEqual(clash.local);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('syncTicketRecord: keeping the local copy publishes it over the published one, records its hash and removes ticket.published.json', async () => {
		const local = recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title this machine holds' })] });
		const { params, ticketFolder } = setupSync({
			local,
			published: recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title another machine published' })] }),
			syncState: { schemaVersion: 1, recordSha256: digestOf({ seed: 'the bytes this machine last published' }), planMarkers: {} },
			publishedCopyOnDisk: true,
		});

		const result = await syncTicketRecord({ ...params, keep: TicketSyncKeep.Local });

		const [attached] = recordWrites();

		expect(result).toStrictEqual({ record: local });
		expect(attached).toStrictEqual({
			settings: expect.objectContaining({ provider: 'linear' }),
			ticketId: 'id-140',
			title: 'ticket.json',
			content: expect.any(Buffer),
			contentType: 'application/json',
		});
		expect(JSON.parse(attached?.content.toString('utf8') ?? 'null')).toStrictEqual(local);
		expect(syncStateOf({ ticketFolder }).recordSha256).toBe(
			createHash('sha256')
				.update(attached?.content ?? Buffer.alloc(0))
				.digest('hex'),
		);
		expect(existsSync(join(ticketFolder, 'ticket.published.json'))).toBe(false);
	});

	test('syncTicketRecord: keeping the local copy republishes a divergent plan held locally and adopts the published marker for one it does not hold', async () => {
		const heldMarker = digestOf({ seed: '003 as the ticket carries it' });
		const elsewhereMarker = digestOf({ seed: '004 as the ticket carries it' });
		const republishedMarker = digestOf({ seed: '003 as this machine has just published it' });
		const { params, cwd, ticketFolder } = setupSync({
			local: recordOf({ plans: [planOf({ id: '003-held-here' }), planOf({ id: '004-held-elsewhere' })] }),
			published: recordOf({
				plans: [planOf({ id: '003-held-here', publishedMarker: heldMarker }), planOf({ id: '004-held-elsewhere', publishedMarker: elsewhereMarker })],
			}),
			syncState: { schemaVersion: 1, planMarkers: {} },
			planFolders: ['003-held-here'],
			republishedMarker,
		});

		const result = await syncTicketRecord({ ...params, keep: TicketSyncKeep.Local });

		expect(mockPublishPlan).toHaveBeenCalledTimes(1);
		expect(mockPublishPlan).toHaveBeenCalledWith(expect.objectContaining({ cwd, name: 'lo-140-multi/003-held-here', titlePrefix: '003-held-here' }));
		expect(recordFrom({ result })?.plans).toEqual([
			expect.objectContaining({ id: '003-held-here', publishedMarker: republishedMarker }),
			expect.objectContaining({ id: '004-held-elsewhere', publishedMarker: elsewhereMarker }),
		]);
		expect(syncStateOf({ ticketFolder }).planMarkers['003-held-here']).toBe(republishedMarker);
	});

	test('syncTicketRecord: keeping the local copy publishes it as the first copy when the ticket carries none', async () => {
		const local = recordOf({ plans: [planOf({ id: '001-ticket-record' })] });
		const { params, ticketFolder } = setupSync({ local, syncState: { schemaVersion: 1, planMarkers: {} } });

		const result = await syncTicketRecord({ ...params, keep: TicketSyncKeep.Local });

		const [attached] = recordWrites();

		expect(result).toStrictEqual({ record: local });
		expect(JSON.parse(attached?.content.toString('utf8') ?? 'null')).toStrictEqual(local);
		expect(mockPublishPlan).not.toHaveBeenCalled();
		expect(syncStateOf({ ticketFolder }).recordSha256).toBe(
			createHash('sha256')
				.update(attached?.content ?? Buffer.alloc(0))
				.digest('hex'),
		);
	});

	test('syncTicketRecord: keeping the local copy leaves the ticket record alone when a divergent plan cannot be republished', async () => {
		const { params, ticketFolder } = setupSync({
			local: recordOf({ plans: [planOf({ id: '003-held-here' })] }),
			published: recordOf({ plans: [planOf({ id: '003-held-here', publishedMarker: digestOf({ seed: '003 as the ticket carries it' }) })] }),
			syncState: { schemaVersion: 1, planMarkers: {} },
			planFolders: ['003-held-here'],
		});

		mockPublishPlan.mockResolvedValue({ published: [], stale: [], error: 'the tracker refused 003-held-here--plan.md' });

		const result = await syncTicketRecord({ ...params, keep: TicketSyncKeep.Local });

		expect(errorFrom({ result })).toContain('the tracker refused 003-held-here--plan.md');
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(syncStateOf({ ticketFolder }).recordSha256).toBeUndefined();
	});

	test('syncTicketRecord: keeping the local copy refuses when there is no local record', async () => {
		const { params, ticketFolder } = setupSync({ published: recordOf({ plans: [planOf({ id: '001-ticket-record' })] }) });

		const result = await syncTicketRecord({ ...params, keep: TicketSyncKeep.Local });

		// The sentence has to name the ticket whose record is missing, so a human
		// reading it knows which branch to sync the other way instead.
		expect(result).toStrictEqual({ error: expect.stringContaining(ticketBranch) });
		expect(errorFrom({ result })).toContain('ticket.json');
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(existsSync(join(ticketFolder, 'ticket.json'))).toBe(false);
	});

	test('syncTicketRecord: keeping the local copy never overwrites a published record newer than the one it read', async () => {
		const local = recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title this machine holds' })] });
		const { params, ticketFolder } = setupSync({
			local,
			published: recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title this command read' })] }),
			publishedAfterFirstRead: recordOf({ plans: [planOf({ id: '001-ticket-record', title: 'The title another machine published next' })] }),
			syncState: { schemaVersion: 1, recordSha256: digestOf({ seed: 'the bytes this machine last published' }), planMarkers: {} },
		});

		const result = await syncTicketRecord({ ...params, keep: TicketSyncKeep.Local });

		expect(errorFrom({ result })).toContain('lightsout work-order sync');
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
		expect(localRecordOf({ ticketFolder })).toStrictEqual(local);
	});

	test("syncTicketRecord: a keep-local sync works entirely inside the ticket's own folder", async () => {
		const republishedMarker = digestOf({ seed: '003 as the ticket folder has just published it' });
		const { ticketFolder, prelayoutFolder, params } = setupTicketFolderSync({ republishedMarker });

		const result = await syncTicketRecord({ ...params, keep: TicketSyncKeep.Local });

		const [attached] = recordWrites();
		const kept = recordOf({ plans: [planOf({ id: '003-held-here', title: 'The title in the ticket folder', publishedMarker: republishedMarker })] });

		expect(result).toStrictEqual({ record: kept });
		expect(JSON.parse(attached?.content.toString('utf8') ?? 'null')).toStrictEqual(kept);
		expect(mockPublishPlan).toHaveBeenCalledWith(expect.objectContaining({ name: 'lo-140-multi/003-held-here', titlePrefix: '003-held-here' }));
		expect(localRecordOf({ ticketFolder })).toStrictEqual(kept);
		expect(syncStateOf({ ticketFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: createHash('sha256')
				.update(attached?.content ?? Buffer.alloc(0))
				.digest('hex'),
			planMarkers: { '003-held-here': republishedMarker },
		});
		expect(JSON.parse(readFileSync(join(prelayoutFolder, 'ticket.json'), 'utf8'))).toStrictEqual(prelayoutRecord);
	});
});
