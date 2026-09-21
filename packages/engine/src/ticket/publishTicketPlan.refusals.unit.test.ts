import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { publishTicketPlan } from '#src/ticket/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam: mocking it is what lets every refusal be
// proven by an empty upload log without a network. The ticket folder, the plan
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

		// The real resolver refuses a configured tracker whose credential is not in
		// the environment, which is a different answer from no tracker at all.
		return apiKey === ''
			? { error: `the tracker API key is missing: set the \`${block['api-key-env']}\` environment variable` }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey };
	},
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

const ticketBranch = 'lo-140-multi-plan';
const planId = '001-ship-guard';
const address = `${ticketBranch}/${planId}`;
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

/** One plan's entry, written by hand so `publishTicketPlan` is the only thing under test. */
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
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode: 'multiple-plan',
	plans,
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: `added plan ${planId}` }],
});

const setupTicketPlan = ({
	files = { 'plan.md': planBody, 'decisions.json': decisionsBody },
	plans,
	syncState,
	published,
}: {
	files?: Record<string, string>;
	/** The plans the local `ticket.json` holds. No value at all means the ticket folder holds no record. */
	plans?: unknown[];
	/** The `ticket-sync.json` sidecar this machine wrote, when the case needs one. */
	syncState?: unknown;
	/** The record the ticket carries as its `ticket.json` attachment, when the case needs one. */
	published?: unknown;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-publish-ticket-plan-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);
	const planFolder = join(ticketFolder, 'plans', planId);
	const progress: string[] = [];

	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' }]);
	mockGetTicketAttachments.mockResolvedValue(
		published === undefined ? [] : [{ id: 'att-record', title: 'ticket.json', url: 'https://tracker.example/ticket.json' }],
	);
	mockReadTicketAsset.mockResolvedValue(JSON.stringify(published ?? {}));
	mockSetTicketAttachment.mockResolvedValue(undefined);

	mkdirSync(planFolder, { recursive: true });

	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(planFolder, name), text);
	}

	if (plans !== undefined) {
		writeFileSync(join(ticketFolder, 'ticket.json'), JSON.stringify(ticketRecordOf({ plans })));
	}

	if (syncState !== undefined) {
		writeFileSync(join(ticketFolder, 'ticket-sync.json'), JSON.stringify(syncState));
	}

	return {
		planFolder,
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

describe('publishTicketPlan', () => {
	test('publishTicketPlan: refuses a plan whose recorded marker this machine never published or restored, before any attachment', async () => {
		const { params } = setupTicketPlan({
			plans: [planEntryOf({ progress: 'ready', publishedMarker: 'a'.repeat(64) })],
			syncState: { schemaVersion: 1, planMarkers: { [planId]: 'b'.repeat(64) } },
		});

		const report = await publishTicketPlan(params);

		expect({ error: report.error, published: report.published, attached: attachedTitles() }).toStrictEqual({
			error: expect.stringContaining(`lightsout ticket sync --name ${ticketBranch}`),
			published: [],
			attached: [],
		});
	});

	test('publishTicketPlan: refuses an implemented plan whose files no longer match its snapshot and publishes one whose files still match', async () => {
		const changed = setupTicketPlan({
			files: { 'plan.md': planBody, 'decisions.json': '[{"id":2}]' },
			plans: [planEntryOf({ progress: 'implemented', snapshot: snapshotOfPlanFolder() })],
		});
		const unchanged = setupTicketPlan({ plans: [planEntryOf({ progress: 'implemented', snapshot: snapshotOfPlanFolder() })] });

		const refused = await publishTicketPlan(changed.params);
		const republished = await publishTicketPlan(unchanged.params);

		// The refusal ran first, so the whole upload log being exactly the second
		// run's titles is what proves the refused plan attached nothing.
		expect({
			refused: { error: refused.error, published: refused.published },
			republished: { error: republished.error, recordError: republished.recordError },
			attached: attachedTitles(),
		}).toStrictEqual({
			refused: { error: expect.stringContaining('lightsout ticket add-plan'), published: [] },
			republished: { error: undefined, recordError: undefined },
			attached: [`${planId}--plan.md`, `${planId}--decisions.json`, `${planId}--plan-attachments.json`, 'ticket.json'],
		});
	});

	test('publishTicketPlan: refuses a plan the ticket record does not hold', async () => {
		const otherPlanOnly = setupTicketPlan({
			plans: [{ id: '002-other-plan', title: 'Another plan', progress: 'planning', createdAt: '2026-01-03T00:00:00.000Z' }],
		});
		const noRecord = setupTicketPlan();

		const unknownPlan = await publishTicketPlan(otherPlanOnly.params);
		const withoutRecord = await publishTicketPlan(noRecord.params);

		expect({
			unknownPlan: { error: unknownPlan.error, published: unknownPlan.published },
			withoutRecord: { error: withoutRecord.error, published: withoutRecord.published },
			attached: attachedTitles(),
		}).toStrictEqual({
			unknownPlan: { error: expect.stringContaining(`lightsout ticket add-plan --name ${ticketBranch}`), published: [] },
			withoutRecord: { error: expect.stringContaining(`lightsout ticket add-plan --name ${ticketBranch}`), published: [] },
			attached: [],
		});
	});

	test('publishTicketPlan: refuses an implemented plan whose folder lost a snapshot file, gained a durable one, or holds no plan at all', async () => {
		const implemented = [planEntryOf({ progress: 'implemented', snapshot: snapshotOfPlanFolder() })];
		const lost = setupTicketPlan({ files: { 'plan.md': planBody }, plans: implemented });
		const gained = setupTicketPlan({ files: { 'plan.md': planBody, 'decisions.json': decisionsBody, 'grade.json': '{"grade":"A"}' }, plans: implemented });
		const empty = setupTicketPlan({ files: {}, plans: implemented });

		const withoutDecisions = await publishTicketPlan(lost.params);
		const withGrade = await publishTicketPlan(gained.params);
		const withoutPlan = await publishTicketPlan(empty.params);

		expect({
			withoutDecisions: withoutDecisions.error,
			withGrade: withGrade.error,
			withoutPlan: withoutPlan.error,
			attached: attachedTitles(),
		}).toEqual({
			withoutDecisions: expect.stringContaining('lightsout ticket add-plan'),
			withGrade: expect.stringContaining('lightsout ticket add-plan'),
			withoutPlan: expect.stringContaining('lightsout ticket add-plan'),
			attached: [],
		});
	});

	test('publishTicketPlan: refuses a name that is not a plan address, and a repository with no ticket tracker, before reaching the record', async () => {
		const { params } = setupTicketPlan({ plans: [planEntryOf({ progress: 'ready' })] });

		const legacyName = await publishTicketPlan({ ...params, address: ticketBranch });
		const localOnly = await publishTicketPlan({ ...params, config: { gates } });

		expect({ legacyName: legacyName.error, localOnly: localOnly.error, attached: attachedTitles() }).toEqual({
			legacyName: expect.stringContaining('<ticket-branch>/<plan-id>'),
			localOnly: expect.stringContaining('ticket-tracker'),
			attached: [],
		});
		expect(localOnly.error).toEqual(expect.stringContaining(planId));
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test('publishTicketPlan: refuses a configured tracker that cannot be used rather than publishing as if it were local only', async () => {
		// Passing over a tracker that IS configured would publish the plan's files
		// with no record behind them, and hide a divergence from every machine.
		const { params } = setupTicketPlan({ plans: [planEntryOf({ progress: 'ready' })] });

		const report = await publishTicketPlan({ ...params, env: {} });

		expect(report).toStrictEqual({ published: [], stale: [], error: expect.stringContaining('LINEAR_API_KEY') });
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(attachedTitles()).toStrictEqual([]);
	});

	test('publishTicketPlan: refuses on a ticket record divergence before any attachment', async () => {
		// No sidecar, so neither copy can be shown to be the one this machine last
		// synced: a local and a published record that differ are a divergence.
		const { params } = setupTicketPlan({
			plans: [planEntryOf({ progress: 'ready' })],
			published: ticketRecordOf({ plans: [{ ...planEntryOf({ progress: 'ready' }), title: 'Renamed on another machine' }] }),
		});

		const report = await publishTicketPlan(params);

		expect({ error: report.error, published: report.published, attached: attachedTitles() }).toStrictEqual({
			error: expect.stringContaining(`lightsout ticket sync --name ${ticketBranch}`),
			published: [],
			attached: [],
		});
	});
});
