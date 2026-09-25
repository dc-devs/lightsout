import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { publishWorkOrderPlan } from '#src/workOrder/publishWorkOrderPlan.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam: mocking it is what lets every refusal be
// proven by an empty upload log without a network. The work order folder, the plan
// folder, the record and the sidecar are all real files in a temporary
// directory, because each refusal is decided from what is on disk.
type TrackerFailure = { error: string };
type TrackerTicket = { id: string; identifier: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
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

		if (block === undefined) {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		const apiKey = env[block['api-key-env']] ?? '';

		// The real resolver refuses a configured tracker whose credential is not in
		// the environment, which is a different answer from no tracker at all.
		return apiKey === ''
			? { error: `the tracker API key is missing: set the \`${block['api-key-env']}\` environment variable` }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey };
	},
}));
jest.mock('#src/ticketTracker/setTicketAttachment.ts', () => ({ setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params) }));
// -------------------------

const name = 'lo-140-multi-plan';
const planId = '001-ship-guard';
const address = `${name}/${planId}`;
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };
const planBody = '# The ship guard\n';
const decisionsBody = '[{"id":1}]';

/** The plan's durable files as a passed run left them — the scope an implemented plan may still publish. */
const snapshotOfPlanFolder = () => [
	{ name: 'plan.md', sha256: sha256({ content: planBody }) },
	{ name: 'decisions.json', sha256: sha256({ content: decisionsBody }) },
];

/** One plan's entry, written by hand so `publishWorkOrderPlan` is the only thing under test. */
const planEntryOf = ({
	progress,
	publishedMarker,
	snapshot,
}: {
	progress: string;
	publishedMarker?: string;
	snapshot?: { name: string; sha256: string }[];
}) => ({
	id: planId,
	title: 'The ship guard',
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(publishedMarker === undefined ? {} : { publishedMarker }),
	...(snapshot === undefined
		? {}
		: {
				implementation: {
					runId: 'run-ship-guard',
					startedAt: '2026-01-02T00:00:00.000Z',
					startCommit: '1111111111111111111111111111111111111111',
					finishedAt: '2026-01-02T01:00:00.000Z',
					snapshot,
				},
			}),
});

/** A record the contract accepts, holding whichever plans a case needs. */
const ticketRecordOf = ({ plans }: { plans: unknown[] }) => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: 'multiple-plan',
	plans,
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: `added plan ${planId}` }],
});

const setupTicketPlan = ({
	files = { 'plan.md': planBody, 'decisions.json': decisionsBody },
	plans,
	syncState,
	published,
	recordText,
}: {
	files?: Record<string, string>;
	/** The plans the local `state.json` holds. No value at all means the work order folder holds no record. */
	plans?: unknown[];
	/** The `state-sync.json` sidecar this machine wrote, when the case needs one. */
	syncState?: unknown;
	/** The record the ticket carries as its `state.json` attachment, when the case needs one. */
	published?: unknown;
	/** The raw bytes written as the local `state.json`, for a record no reader can parse. */
	recordText?: string;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-publish-ticket-plan-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const planFolder = join(workOrderFolder, 'plans', planId);
	const progress: string[] = [];

	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' }]);
	mockGetTicketAttachments.mockResolvedValue(
		published === undefined ? [] : [{ id: 'att-record', title: 'state.json', url: 'https://tracker.example/state.json' }],
	);
	mockReadTicketAsset.mockResolvedValue(JSON.stringify(published ?? {}));
	mockSetTicketAttachment.mockResolvedValue(undefined);

	mkdirSync(planFolder, { recursive: true });

	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(planFolder, name), text);
	}

	if (plans !== undefined) {
		writeFileSync(join(workOrderFolder, 'state.json'), JSON.stringify(ticketRecordOf({ plans })));
	}

	if (recordText !== undefined) {
		writeFileSync(join(workOrderFolder, 'state.json'), recordText);
	}

	if (syncState !== undefined) {
		writeFileSync(join(workOrderFolder, 'state-sync.json'), JSON.stringify(syncState));
	}

	return {
		planFolder,
		workOrderFolder,
		progress,
		params: {
			cwd,
			address,
			config: { gates, 'ticket-tracker': trackerBlock },
			env,
			onProgress: (message: string) => progress.push(message),
		},
	};
};

/** Every attachment title the tracker was asked to write, in the order it was asked. */
const attachedTitles = () => mockSetTicketAttachment.mock.calls.map(([call]) => call.title);

describe('publishWorkOrderPlan', () => {
	test('publishWorkOrderPlan: refuses a plan whose recorded marker this machine never published or restored, before any attachment', async () => {
		const { params } = setupTicketPlan({
			plans: [planEntryOf({ progress: 'ready', publishedMarker: 'a'.repeat(64) })],
			syncState: { schemaVersion: 1, planMarkers: { [planId]: 'b'.repeat(64) } },
		});

		const report = await publishWorkOrderPlan(params);

		expect({ error: report.error, published: report.published, attached: attachedTitles() }).toStrictEqual({
			error: expect.stringContaining(`lightsout work-order sync --name ${name}`),
			published: [],
			attached: [],
		});
	});

	test('publishWorkOrderPlan: refuses an implemented plan whose files no longer match its snapshot and publishes one whose files still match', async () => {
		const changed = setupTicketPlan({
			files: { 'plan.md': planBody, 'decisions.json': '[{"id":2}]' },
			plans: [planEntryOf({ progress: 'implemented', snapshot: snapshotOfPlanFolder() })],
		});
		const unchanged = setupTicketPlan({ plans: [planEntryOf({ progress: 'implemented', snapshot: snapshotOfPlanFolder() })] });

		const refused = await publishWorkOrderPlan(changed.params);
		const republished = await publishWorkOrderPlan(unchanged.params);

		// The refusal ran first, so the whole upload log being exactly the second
		// run's titles is what proves the refused plan attached nothing.
		expect({
			refused: { error: refused.error, published: refused.published },
			republished: { error: republished.error, recordError: republished.recordError },
			attached: attachedTitles(),
		}).toStrictEqual({
			refused: { error: expect.stringContaining('lightsout work-order add-plan'), published: [] },
			republished: { error: undefined, recordError: undefined },
			attached: [`${planId}--plan.md`, `${planId}--decisions.json`, `${planId}--plan-attachments.json`, 'state.json'],
		});
	});

	test('publishWorkOrderPlan: refuses a plan the work order state does not hold, and a work order with no record at all', async () => {
		const otherPlanOnly = setupTicketPlan({
			plans: [{ id: '002-other-plan', title: 'Another plan', progress: 'planning', createdAt: '2026-01-03T00:00:00.000Z' }],
		});
		const noRecord = setupTicketPlan();

		const unknownPlan = await publishWorkOrderPlan(otherPlanOnly.params);
		const withoutRecord = await publishWorkOrderPlan(noRecord.params);

		// A work order with no record names no ticket either, so it is refused for
		// belonging to none rather than for holding no such plan.
		expect({
			unknownPlan: { error: unknownPlan.error, published: unknownPlan.published },
			withoutRecord: { error: withoutRecord.error, published: withoutRecord.published },
			attached: attachedTitles(),
		}).toStrictEqual({
			unknownPlan: { error: expect.stringContaining(`lightsout work-order add-plan --name ${name}`), published: [] },
			withoutRecord: { error: expect.stringContaining('carries no ticket reference'), published: [] },
			attached: [],
		});
	});

	test("publishWorkOrderPlan: refuses when this machine's own record cannot be read, naming the file, before any attachment", async () => {
		// The record is read before the tracker is resolved, because it is the only
		// thing that says which ticket this work order belongs to. A record nothing
		// can parse therefore stops the publish by name rather than by a reference
		// guessed from the label.
		const { params, workOrderFolder } = setupTicketPlan({ recordText: '{ half a record' });

		const report = await publishWorkOrderPlan(params);

		expect({ error: report.error, published: report.published, stale: report.stale, attached: attachedTitles() }).toStrictEqual({
			error: expect.stringContaining(join(workOrderFolder, 'state.json')),
			published: [],
			stale: [],
			attached: [],
		});
	});

	test('publishWorkOrderPlan: refuses an implemented plan whose folder lost a snapshot file, gained a durable one, or holds no plan at all', async () => {
		const implemented = [planEntryOf({ progress: 'implemented', snapshot: snapshotOfPlanFolder() })];
		const lost = setupTicketPlan({ files: { 'plan.md': planBody }, plans: implemented });
		const gained = setupTicketPlan({ files: { 'plan.md': planBody, 'decisions.json': decisionsBody, 'grade.json': '{"grade":"A"}' }, plans: implemented });
		const empty = setupTicketPlan({ files: {}, plans: implemented });

		const withoutDecisions = await publishWorkOrderPlan(lost.params);
		const withGrade = await publishWorkOrderPlan(gained.params);
		const withoutPlan = await publishWorkOrderPlan(empty.params);

		expect({
			withoutDecisions: withoutDecisions.error,
			withGrade: withGrade.error,
			withoutPlan: withoutPlan.error,
			attached: attachedTitles(),
		}).toEqual({
			withoutDecisions: expect.stringContaining('lightsout work-order add-plan'),
			withGrade: expect.stringContaining('lightsout work-order add-plan'),
			withoutPlan: expect.stringContaining('lightsout work-order add-plan'),
			attached: [],
		});
	});

	test('publishWorkOrderPlan: refuses a name that is not a plan address, and a repository with no ticket tracker, before reaching the record', async () => {
		const { params } = setupTicketPlan({ plans: [planEntryOf({ progress: 'ready' })] });

		const legacyName = await publishWorkOrderPlan({ ...params, address: name });
		const localOnly = await publishWorkOrderPlan({ ...params, config: { gates } });

		expect({ legacyName: legacyName.error, localOnly: localOnly.error, attached: attachedTitles() }).toEqual({
			legacyName: expect.stringContaining('<ticket-branch>/<plan-id>'),
			localOnly: expect.stringContaining('ticket-tracker'),
			attached: [],
		});
		expect(localOnly.error).toEqual(expect.stringContaining(planId));
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test('publishWorkOrderPlan: refuses a configured tracker that cannot be used rather than publishing as if it were local only', async () => {
		// Passing over a tracker that IS configured would publish the plan's files
		// with no record behind them, and hide a divergence from every machine.
		const { params } = setupTicketPlan({ plans: [planEntryOf({ progress: 'ready' })] });

		const report = await publishWorkOrderPlan({ ...params, env: {} });

		expect(report).toStrictEqual({ published: [], stale: [], error: expect.stringContaining('LINEAR_API_KEY') });
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(attachedTitles()).toStrictEqual([]);
	});

	test('publishWorkOrderPlan: refuses on a work order state divergence before any attachment', async () => {
		// No sidecar, so neither copy can be shown to be the one this machine last
		// synced: a local and a published record that differ are a divergence.
		const { params } = setupTicketPlan({
			plans: [planEntryOf({ progress: 'ready' })],
			published: ticketRecordOf({ plans: [{ ...planEntryOf({ progress: 'ready' }), title: 'Renamed on another machine' }] }),
		});

		const report = await publishWorkOrderPlan(params);

		expect({ error: report.error, published: report.published, attached: attachedTitles() }).toStrictEqual({
			error: expect.stringContaining(`lightsout work-order sync --name ${name}`),
			published: [],
			attached: [],
		});
	});

	test('publishWorkOrderPlan: every refusal that names a command spells the work-order command word', async () => {
		const missingPlan = setupTicketPlan({
			plans: [{ id: '002-other-plan', title: 'Another plan', progress: 'planning', createdAt: '2026-01-03T00:00:00.000Z' }],
		});
		const publishedElsewhere = setupTicketPlan({
			plans: [planEntryOf({ progress: 'ready', publishedMarker: 'a'.repeat(64) })],
			syncState: { schemaVersion: 1, planMarkers: { [planId]: 'b'.repeat(64) } },
		});
		const filesChanged = setupTicketPlan({
			files: { 'plan.md': planBody, 'decisions.json': '[{"id":2}]' },
			plans: [planEntryOf({ progress: 'implemented', snapshot: snapshotOfPlanFolder() })],
		});

		const unknownPlan = await publishWorkOrderPlan(missingPlan.params);
		const republished = await publishWorkOrderPlan(publishedElsewhere.params);
		const changed = await publishWorkOrderPlan(filesChanged.params);

		expect({
			unknownPlan: unknownPlan.error,
			republished: republished.error,
			changed: changed.error,
			attached: attachedTitles(),
		}).toEqual({
			unknownPlan: expect.stringContaining(`lightsout work-order add-plan --name ${name} --slug <slug>`),
			republished: expect.stringContaining(`lightsout work-order sync --name ${name} --keep local`),
			changed: expect.stringContaining(`lightsout work-order add-plan --name ${name} --slug <slug>`),
			attached: [],
		});
		// One joined string, so a single refusal left at the old command word fails
		// the case no matter which of the three it is.
		expect([unknownPlan.error, republished.error, changed.error].join('\n')).toEqual(expect.not.stringContaining('lightsout ticket '));
	});
});
