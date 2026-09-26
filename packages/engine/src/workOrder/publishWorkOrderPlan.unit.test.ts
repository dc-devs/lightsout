import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { publishWorkOrderPlan } from '#src/workOrder/publishWorkOrderPlan.ts';
import { canonicalTicketRecordText } from '#tests/helpers/canonicalTicketRecordText.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam, standing in for the ticket as a map of
// title to text: a publish writes into it and the next read sees what landed,
// which is what lets the whole order — brainstorm, plan, state.json — be
// asserted without a network. The plan folder, the record and the sidecar are
// real files in a temporary directory.
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

		return { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: env[block['api-key-env']] ?? '' };
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
const notesBody = '# How the ship guard was shaped\n';

const planTitles = [`${planId}--plan.md`, `${planId}--decisions.json`, `${planId}--plan-attachments.json`];
const brainstormTitles = [`${planId}--brainstorm-notes.md`, `${planId}--brainstorm-attachments.json`];

/** The marker a brainstorm publish of these notes alone commits, which is what "already published" means to this plan. */
const brainstormMarkerText = serializeAttachmentManifest({ files: [{ name: 'brainstorm-notes.md', content: Buffer.from(notesBody, 'utf8') }] }).toString(
	'utf8',
);

/** A record the contract accepts, holding this ticket's one plan. */
const ticketRecordOf = ({ progress = PlanProgress.Planning, title = 'The ship guard' }: { progress?: PlanProgress; title?: string } = {}): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans: [{ id: planId, title, progress, createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: `added plan ${planId}` }],
});

const setupTicketPlan = async ({
	progress = PlanProgress.Planning,
	brainstormPublished = false,
	brainstormMarker = brainstormMarkerText,
	published,
	sidecarOf,
	uploadFailures = {},
	onAttach,
}: {
	/** The progress the plan's entry in the local record carries. */
	progress?: PlanProgress;
	/** Whether the ticket already carries this plan's brainstorm generation, committing the notes on disk. */
	brainstormPublished?: boolean;
	/** The text of the brainstorm marker the ticket carries, for a marker that cannot be parsed. */
	brainstormMarker?: string;
	/** The record the ticket carries as its `state.json` attachment, when the case needs one. */
	published?: WorkOrderState;
	/** The record whose hash `state-sync.json` holds, when the case needs a sidecar. */
	sidecarOf?: WorkOrderState;
	/** Each attachment title the tracker refuses, and the sentence it refuses with. */
	uploadFailures?: Record<string, string>;
	/** Runs after each attachment lands, so a row can move the ticket on mid-publish. */
	onAttach?: (params: { title: string; assets: Map<string, string> }) => void;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-publish-ticket-plan-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const planFolder = join(workOrderFolder, 'plans', planId);
	const syncPath = join(workOrderFolder, 'state-sync.json');
	const progressLines: string[] = [];
	const assets = new Map<string, string>();

	mkdirSync(planFolder, { recursive: true });
	writeFileSync(join(planFolder, 'plan.md'), planBody);
	writeFileSync(join(planFolder, 'decisions.json'), decisionsBody);
	writeFileSync(join(planFolder, 'brainstorm-notes.md'), notesBody);
	writeFileSync(join(workOrderFolder, 'state.json'), JSON.stringify(ticketRecordOf({ progress })));

	if (brainstormPublished) {
		assets.set(`${planId}--brainstorm-notes.md`, notesBody);
		assets.set(`${planId}--brainstorm-attachments.json`, brainstormMarker);
	}

	if (published !== undefined) {
		assets.set('state.json', JSON.stringify(published));
	}

	if (sidecarOf !== undefined) {
		const recordSha256 = sha256({ content: await canonicalTicketRecordText({ record: sidecarOf }) });

		writeFileSync(syncPath, `${JSON.stringify({ planMarkers: {}, recordSha256, schemaVersion: 1 }, undefined, '\t')}\n`);
	}

	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' }]);
	mockGetTicketAttachments.mockImplementation(async () =>
		[...assets.keys()].map((title, index) => ({ id: `att-${index}`, title, url: `https://tracker.example/${encodeURIComponent(title)}` })),
	);
	mockReadTicketAsset.mockImplementation(async ({ url }) => {
		const title = decodeURIComponent(url.split('/').at(-1) ?? '');

		return assets.get(title) ?? { error: `no asset titled ${title}` };
	});
	mockSetTicketAttachment.mockImplementation(async ({ title, content }) => {
		const failure = uploadFailures[title];

		if (failure !== undefined) {
			return { error: failure };
		}

		assets.set(title, content.toString('utf8'));
		onAttach?.({ title, assets });

		return undefined;
	});

	return {
		assets,
		syncPath,
		progress: progressLines,
		params: {
			cwd,
			address,
			config: { gates, 'ticket-tracker': trackerBlock },
			env,
			onProgress: (message: string) => progressLines.push(message),
		},
	};
};

/**
 * The ordinary publish — which `setupTicketPlan` already arranges under
 * `work-orders/<name>/` — with a pre-layout copy of the same plan left beside it,
 * carrying different plan text and a different plan title. What lands on the
 * ticket therefore says which of the two folders was read.
 */
const setupTicketFolderPlan = async () => {
	const base = await setupTicketPlan();
	const preLayoutFolder = join(base.params.cwd, '.lightsout', 'plans', name);

	mkdirSync(join(preLayoutFolder, planId), { recursive: true });
	writeFileSync(join(preLayoutFolder, planId, 'plan.md'), '# The pre-layout copy\n');
	writeFileSync(join(preLayoutFolder, 'state.json'), JSON.stringify(ticketRecordOf({ title: 'The pre-layout copy' })));

	return base;
};

/**
 * The ordinary publish, with the record carrying a ticket reference the work
 * order's label does not spell. Every identifier the tracker is then asked for
 * says whether the reference came from the record or from the label.
 */
const setupRecordTicketRefPlan = async ({ ticketRef = 'LO-902' }: { ticketRef?: string } = {}) => {
	const base = await setupTicketPlan();

	writeFileSync(join(base.params.cwd, '.lightsout', 'work-orders', name, 'state.json'), JSON.stringify({ ...ticketRecordOf(), ticketRef }));
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-902', identifier: ticketRef }]);

	return base;
};

/** Every attachment title the tracker was asked to write, in the order it was asked. */
const attachedTitles = () => mockSetTicketAttachment.mock.calls.map(([call]) => call.title);

/** Every distinct ticket identifier the tracker was asked for, in the order each was first asked. */
const identifiersAsked = () => [...new Set(mockGetTicketsByIdentifiers.mock.calls.flatMap(([call]) => call.identifiers))];

/** The hash of the plan marker bytes that actually landed on the ticket — what the record's `publishedMarker` must equal. */
const markerHashOf = ({ assets }: { assets: Map<string, string> }) => sha256({ content: assets.get(`${planId}--plan-attachments.json`) ?? '' });

/** The plan's entry as the ticket's published `state.json` describes it. */
const publishedPlanOf = ({ assets }: { assets: Map<string, string> }) => {
	const record = JSON.parse(assets.get('state.json') ?? 'null') as WorkOrderState | null;
	const plan = record?.plans.find((entry) => entry.id === planId);

	return { progress: plan?.progress, publishedMarker: plan?.publishedMarker };
};

/** The plan's title as the ticket's published `state.json` describes it — which says which record on disk was read. */
const publishedPlanTitleOf = ({ assets }: { assets: Map<string, string> }) => {
	const record = JSON.parse(assets.get('state.json') ?? 'null') as WorkOrderState | null;

	return record?.plans.find((entry) => entry.id === planId)?.title;
};

/** The marker hash the sidecar holds for this plan, or undefined when it holds none. */
const sidecarMarkerOf = ({ syncPath }: { syncPath: string }) => {
	if (!existsSync(syncPath)) {
		return undefined;
	}

	const sync = JSON.parse(readFileSync(syncPath, 'utf8')) as { planMarkers?: Record<string, string> };

	return sync.planMarkers?.[planId];
};

describe('publishWorkOrderPlan', () => {
	test('publishWorkOrderPlan: publishes the changed brainstorm notes, then the plan under its prefix, then state.json with the plan ready and its marker recorded', async () => {
		const { params, assets, syncPath } = await setupTicketPlan();

		const report = await publishWorkOrderPlan(params);

		expect({
			report: { published: report.published, stale: report.stale, error: report.error, recordError: report.recordError },
			attached: attachedTitles(),
			publishedPlan: publishedPlanOf({ assets }),
			sidecarMarker: sidecarMarkerOf({ syncPath }),
		}).toStrictEqual({
			report: {
				published: [...brainstormTitles, ...planTitles, 'state.json'],
				stale: [],
				error: undefined,
				recordError: undefined,
			},
			attached: [...brainstormTitles, ...planTitles, 'state.json'],
			publishedPlan: { progress: 'ready', publishedMarker: markerHashOf({ assets }) },
			sidecarMarker: markerHashOf({ assets }),
		});
	});

	test('publishWorkOrderPlan: skips the brainstorm generation when its marker already commits the notes on disk', async () => {
		const { params } = await setupTicketPlan({ brainstormPublished: true });

		const report = await publishWorkOrderPlan(params);

		expect({ published: report.published, error: report.error, recordError: report.recordError, attached: attachedTitles() }).toStrictEqual({
			published: [...planTitles, 'state.json'],
			error: undefined,
			recordError: undefined,
			attached: [...planTitles, 'state.json'],
		});
	});

	test("publishWorkOrderPlan: leaves a plan's progress alone unless it is still planning", async () => {
		const { params, assets } = await setupTicketPlan({ progress: PlanProgress.Implementing, brainstormPublished: true });

		const report = await publishWorkOrderPlan(params);

		expect({
			error: report.error,
			recordError: report.recordError,
			publishedPlan: publishedPlanOf({ assets }),
		}).toStrictEqual({
			error: undefined,
			recordError: undefined,
			publishedPlan: { progress: 'implementing', publishedMarker: markerHashOf({ assets }) },
		});
	});

	test('publishWorkOrderPlan: an interrupted record update leaves the plan publishable again rather than divergent', async () => {
		// The sidecar names the copy the ticket carries, so the first pull sees
		// only the local record as moved and goes ahead. Another machine then
		// publishes while the plan's files are landing, which is the divergence
		// the record update's own pull finds afterwards.
		const published = ticketRecordOf({ title: 'Titled on another machine' });
		const moved = ticketRecordOf({ title: 'Moved on another machine' });
		let swapped = false;
		const { params, assets, syncPath } = await setupTicketPlan({
			published,
			sidecarOf: published,
			onAttach: ({ title, assets: onTicket }) => {
				if (title === `${planId}--plan-attachments.json` && !swapped) {
					swapped = true;
					onTicket.set('state.json', JSON.stringify(moved));
				}
			},
		});

		const interrupted = await publishWorkOrderPlan(params);
		// Read where the claim is about: the interrupted publish left the sidecar
		// alone, which is exactly what the retry below is then free to complete.
		const sidecarAfterInterrupted = sidecarMarkerOf({ syncPath });
		assets.set('state.json', JSON.stringify(ticketRecordOf()));
		const retried = await publishWorkOrderPlan(params);

		expect({
			interrupted: { error: interrupted.error, recordError: interrupted.recordError, sidecarMarker: sidecarAfterInterrupted },
			retried: { error: retried.error, recordError: retried.recordError, publishedPlan: publishedPlanOf({ assets }) },
		}).toStrictEqual({
			interrupted: {
				error: undefined,
				recordError: expect.stringContaining(`lightsout work-order sync --name ${name}`),
				sidecarMarker: undefined,
			},
			retried: {
				error: undefined,
				recordError: undefined,
				publishedPlan: { progress: 'ready', publishedMarker: markerHashOf({ assets }) },
			},
		});
	});

	test('publishWorkOrderPlan: republishes the brainstorm generation when the marker on the ticket cannot be parsed', async () => {
		const { params } = await setupTicketPlan({ brainstormPublished: true, brainstormMarker: 'this is not a commit marker' });

		const report = await publishWorkOrderPlan(params);

		expect({ published: report.published, error: report.error, recordError: report.recordError }).toStrictEqual({
			published: [...brainstormTitles, ...planTitles, 'state.json'],
			error: undefined,
			recordError: undefined,
		});
	});

	test("publishWorkOrderPlan: the plan is published out of the ticket's plans folder", async () => {
		const { params, assets, syncPath } = await setupTicketFolderPlan();

		const report = await publishWorkOrderPlan(params);

		expect({
			published: report.published,
			error: report.error,
			recordError: report.recordError,
			planText: assets.get(`${planId}--plan.md`),
			publishedPlan: publishedPlanOf({ assets }),
			publishedTitle: publishedPlanTitleOf({ assets }),
			sidecarMarker: sidecarMarkerOf({ syncPath }),
		}).toStrictEqual({
			published: [...brainstormTitles, ...planTitles, 'state.json'],
			error: undefined,
			recordError: undefined,
			planText: planBody,
			publishedPlan: { progress: 'ready', publishedMarker: markerHashOf({ assets }) },
			publishedTitle: 'The ship guard',
			sidecarMarker: markerHashOf({ assets }),
		});
	});

	test("publishes against the record's ticket reference", async () => {
		const { params, assets } = await setupRecordTicketRefPlan();

		const report = await publishWorkOrderPlan(params);

		expect({
			ticketRef: report.ticketRef,
			error: report.error,
			recordError: report.recordError,
			published: report.published,
			identifiers: identifiersAsked(),
			publishedPlan: publishedPlanOf({ assets }),
		}).toStrictEqual({
			ticketRef: 'LO-902',
			error: undefined,
			recordError: undefined,
			published: [...brainstormTitles, ...planTitles, 'state.json'],
			identifiers: ['LO-902'],
			publishedPlan: { progress: 'ready', publishedMarker: markerHashOf({ assets }) },
		});
	});
});
