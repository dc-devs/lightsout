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

/**
 * What a plan publish leaves behind when the tracker refuses partway through.
 *
 * A sibling of `publishWorkOrderPlan.unit.test.ts` rather than more cases in
 * it: that file states what a publish that lands writes and in which order,
 * while every case here is about a publish that stops — the marker that must
 * not be recorded, and the record that must stay publishable again.
 */

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

/** Every attachment title the tracker was asked to write, in the order it was asked. */
const attachedTitles = () => mockSetTicketAttachment.mock.calls.map(([call]) => call.title);

/** The plan's entry as the ticket's published `state.json` describes it. */
const publishedPlanOf = ({ assets }: { assets: Map<string, string> }) => {
	const record = JSON.parse(assets.get('state.json') ?? 'null') as WorkOrderState | null;
	const plan = record?.plans.find((entry) => entry.id === planId);

	return { progress: plan?.progress, publishedMarker: plan?.publishedMarker };
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
	test('publishWorkOrderPlan: stops at the brainstorm generation the tracker refused and records no marker', async () => {
		const { params, syncPath } = await setupTicketPlan({ uploadFailures: { [`${planId}--brainstorm-notes.md`]: 'the tracker refused the notes' } });

		const report = await publishWorkOrderPlan(params);

		expect({ published: report.published, error: report.error, sidecarMarker: sidecarMarkerOf({ syncPath }) }).toEqual({
			published: [],
			error: expect.stringContaining('the tracker refused the notes'),
			sidecarMarker: undefined,
		});
	});

	test('publishWorkOrderPlan: stops at the plan file the tracker refused and records no marker', async () => {
		const { params, syncPath } = await setupTicketPlan({
			brainstormPublished: true,
			uploadFailures: { [`${planId}--plan.md`]: 'the tracker refused plan.md' },
		});

		const report = await publishWorkOrderPlan(params);

		expect({ published: report.published, error: report.error, sidecarMarker: sidecarMarkerOf({ syncPath }) }).toEqual({
			published: [],
			error: expect.stringContaining('the tracker refused plan.md'),
			sidecarMarker: undefined,
		});
	});

	test('publishWorkOrderPlan: reports that the publish could not be recorded when the plan left the record while its files were landing', async () => {
		// The sidecar names the copy both machines started from, so the record
		// update's own pull takes the ticket's newer record — one another machine
		// dropped this plan from. The files did land, so the plan titles stand and
		// the sentence says the record does not describe them.
		const agreed = ticketRecordOf();
		const withoutThePlan: WorkOrderState = { ...agreed, plans: [] };
		let dropped = false;
		const { params, assets, syncPath } = await setupTicketPlan({
			brainstormPublished: true,
			published: agreed,
			sidecarOf: agreed,
			onAttach: ({ title, assets: onTicket }) => {
				if (title === `${planId}--plan-attachments.json` && !dropped) {
					dropped = true;
					onTicket.set('state.json', JSON.stringify(withoutThePlan));
				}
			},
		});

		const report = await publishWorkOrderPlan(params);

		const landed = { published: report.published, error: report.error, recordError: report.recordError, sidecarMarker: sidecarMarkerOf({ syncPath }) };

		expect(landed).toEqual({
			published: planTitles,
			error: undefined,
			recordError: expect.stringContaining(`no longer holds plan ${planId}`),
			sidecarMarker: undefined,
		});
		expect(attachedTitles()).toStrictEqual(planTitles);
		expect(publishedPlanOf({ assets })).toStrictEqual({ progress: undefined, publishedMarker: undefined });
	});

	test("publishWorkOrderPlan: reports a state.json publish failure after the plan's files landed", async () => {
		const { params } = await setupTicketPlan({
			brainstormPublished: true,
			uploadFailures: { 'state.json': 'the tracker refused the state.json attachment' },
		});

		const report = await publishWorkOrderPlan(params);

		expect({ published: report.published, error: report.error, recordError: report.recordError, attached: attachedTitles() }).toEqual({
			published: planTitles,
			error: undefined,
			recordError: expect.stringContaining('the tracker refused the state.json attachment'),
			attached: [...planTitles, 'state.json'],
		});
	});
});
