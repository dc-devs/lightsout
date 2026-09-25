import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { createWorkOrderShipGuard } from '#src/workOrder/implementRun/createWorkOrderShipGuard.ts';
import { retitleWorkOrderPlan } from '#src/workOrder/retitleWorkOrderPlan.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Only the three calls that would touch the network are doubled, and only the
// rows configuring a tracker reach them: every other row configures none at
// all, so the record is local and the guard never reaches for one.
type TrackerFailure = { error: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/getTicketAttachments.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
}));
jest.mock('#src/ticketTracker/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
jest.mock('#src/ticketTracker/readTicketAsset.ts', () => ({
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';
const assetUrl = 'https://uploads.example.com/state.json';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** No `ticket-tracker` block, so the record is local only and nothing is reached for. */
const localConfig: LightsoutConfig = { gates };
const trackerConfig: LightsoutConfig = { gates, 'ticket-tracker': { ...ticketTrackerConfigBlock, provider: 'linear' } };
const linearEnv = { LINEAR_API_KEY: 'lin_key' };
const mergeCommit = 'a1b2c3d4e5f6';
/** What the tracker says when the ticket the record would be attached to cannot be looked up at all. */
const trackerLookupFailure = 'the tracker answered 503';
const firstEvent = { at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added plan 001-search-basics' };

const planOf = ({ id, progress = PlanProgress.Ready, excludedFor }: { id: string; progress?: PlanProgress; excludedFor?: string }): WorkOrderPlan => ({
	id,
	title: id,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(excludedFor === undefined ? {} : { exclusion: { at: '2026-01-02T00:00:00.000Z', reason: excludedFor, implementationRemoved: false } }),
});

const recordOf = ({
	mode = WorkOrderMode.MultiplePlan,
	plans,
	shipRequest,
	detail,
}: {
	mode?: WorkOrderMode;
	plans: WorkOrderPlan[];
	/** The plan ids an explicit ship request names. */
	shipRequest?: string[];
	/** What a row varies to make two otherwise identical records differ. */
	detail?: string;
}): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode,
	plans,
	...(shipRequest === undefined ? {} : { shipRequest: { planIds: shipRequest, requestedAt: '2026-01-03T00:00:00.000Z' } }),
	history: [detail === undefined ? firstEvent : { ...firstEvent, detail }],
});

/** The two implemented plans and the request naming exactly them: the arrangement an authorized multiple-plan ticket is in. */
const authorizedPlans = [
	planOf({ id: '001-search-basics', progress: PlanProgress.Implemented }),
	planOf({ id: '002-fix-x', progress: PlanProgress.Implemented }),
];

/**
 * The exact bytes the store writes for a record, taken from a throwaway
 * checkout, so a row can name the hash a sidecar holds without this file
 * restating the record's byte form.
 */
const canonicalBytesOf = async ({ record }: { record: WorkOrderState }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-guard-bytes-'));
	const written = await updateLocalWorkOrderState({ cwd, name, change: () => record });

	if ('error' in written) {
		throw new Error(written.error);
	}

	return readFileSync(join(cwd, '.lightsout', 'work-orders', name, 'state.json'));
};

/**
 * A checkout outside any repository, so the shared state directory is its own
 * and the work order folder is a path the row can name: whatever record the branch
 * holds locally, whatever the ticket carries, and the guard built over them.
 */
const setupGuard = async ({
	record,
	published,
	syncedTo,
	corrupt = false,
	config = localConfig,
	env = {},
}: {
	/** The record already in the primary checkout, or none at all. */
	record?: WorkOrderState;
	/** The record the ticket carries as its published `state.json`. */
	published?: WorkOrderState;
	/** The record whose bytes the sidecar names as last published or restored. No sidecar when absent. */
	syncedTo?: WorkOrderState;
	/** Leave a `state.json` behind that is not a record at all. */
	corrupt?: boolean;
	config?: LightsoutConfig;
	env?: NodeJS.ProcessEnv;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ship-guard-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const recordPath = join(workOrderFolder, 'state.json');
	const progress: string[] = [];

	mockGetTicketAttachments.mockResolvedValue(published === undefined ? [] : [{ id: 'att-1', title: 'state.json', url: assetUrl }]);
	mockReadTicketAsset.mockResolvedValue(published === undefined ? { error: 'the ticket carries no state.json' } : JSON.stringify(published));
	// No row here wants a publish to land, so the one call that would put bytes on
	// the ticket never gets that far: the lookup before it always fails.
	mockGetTicketsByIdentifiers.mockResolvedValue({ error: trackerLookupFailure });

	if (record !== undefined) {
		const seeded = await updateLocalWorkOrderState({ cwd, name, change: () => record });

		if ('error' in seeded) {
			throw new Error(seeded.error);
		}
	}

	if (corrupt) {
		mkdirSync(workOrderFolder, { recursive: true });
		writeFileSync(recordPath, '{ "branch": ');
	}

	if (syncedTo !== undefined) {
		mkdirSync(workOrderFolder, { recursive: true });
		writeFileSync(
			join(workOrderFolder, 'state-sync.json'),
			JSON.stringify({ schemaVersion: 1, recordSha256: sha256({ content: await canonicalBytesOf({ record: syncedTo }) }), planMarkers: {} }),
		);
	}

	return {
		cwd,
		recordPath,
		before: existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : undefined,
		progress,
		branch: name,
		guard: createWorkOrderShipGuard({ config, env, onProgress: (message: string) => progress.push(message) }),
	};
};

/** The record as it stands on disk now. */
const readRecordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState;

describe('createWorkOrderShipGuard', () => {
	test('authorizes a branch whose ticket has no record', async () => {
		const { guard, cwd, branch } = await setupGuard();

		const refusal = await guard.authorize({ cwd, branch });

		expect(refusal).toBeUndefined();
	});

	test('authorizes a single-plan ticket only once plan 001 is implemented', async () => {
		// Two arrangements, because the row is about the difference between them:
		// the same ticket answers differently on plan 001's progress alone.
		const implemented = await setupGuard({
			record: recordOf({ mode: WorkOrderMode.SinglePlan, plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })] }),
		});
		const ready = await setupGuard({ record: recordOf({ mode: WorkOrderMode.SinglePlan, plans: [planOf({ id: '001-search-basics' })] }) });

		const refusals = [
			await implemented.guard.authorize({ cwd: implemented.cwd, branch: implemented.branch }),
			await ready.guard.authorize({ cwd: ready.cwd, branch: ready.branch }),
		];

		expect(refusals).toEqual([undefined, expect.stringContaining('001-search-basics')]);
	});

	test('authorizes a single-plan ticket holding no plan 001 only once its build from the ticket body is implemented', async () => {
		// Two arrangements, because the row is about the difference between them:
		// the same plan-less ticket answers differently on its build's progress alone.
		const planless = recordOf({ mode: WorkOrderMode.SinglePlan, plans: [] });
		const implemented = await setupGuard({
			record: {
				...planless,
				ticketBodyBuild: {
					runId: 'run-body-1',
					progress: PlanProgress.Implemented,
					startedAt: '2026-01-04T00:00:00.000Z',
					finishedAt: '2026-01-04T01:00:00.000Z',
				},
			},
		});
		const failed = await setupGuard({
			record: {
				...planless,
				ticketBodyBuild: {
					runId: 'run-body-1',
					progress: PlanProgress.Failed,
					startedAt: '2026-01-04T00:00:00.000Z',
					finishedAt: '2026-01-04T01:00:00.000Z',
				},
			},
		});

		const refusals = [
			await implemented.guard.authorize({ cwd: implemented.cwd, branch: implemented.branch }),
			await failed.guard.authorize({ cwd: failed.cwd, branch: failed.branch }),
		];

		expect(refusals).toEqual([undefined, expect.stringContaining('run-body-1')]);
	});

	test('authorizes a multiple-plan ticket only while its ship request covers exactly its implemented non-excluded plans', async () => {
		const { guard, cwd, branch } = await setupGuard({ record: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'] }) });

		const approved = await guard.authorize({ cwd, branch });

		const added = await updateLocalWorkOrderState({
			cwd,
			name: branch,
			change: (current) =>
				current === undefined
					? { error: 'the row seeded a record' }
					: { ...current, plans: [...current.plans, planOf({ id: '003-late-fix', progress: PlanProgress.Implemented })] },
		});
		const afterAdding = await guard.authorize({ cwd, branch });

		expect({ approved, added: 'error' in added ? added.error : 'written', afterAdding }).toEqual({
			approved: undefined,
			added: 'written',
			afterAdding: expect.stringContaining('003-late-fix'),
		});
	});

	test('keeps authorizing a ship request after a plan is only retitled', async () => {
		const { guard, cwd, branch } = await setupGuard({ record: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'] }) });

		const approved = await guard.authorize({ cwd, branch });

		const retitled = await retitleWorkOrderPlan({ cwd, name: branch, plan: '002-fix-x', title: 'Fix search ranking', config: localConfig, env: {} });
		const afterRetitling = await guard.authorize({ cwd, branch });

		expect({ approved, retitled: 'error' in retitled ? retitled.error : 'written', afterRetitling }).toStrictEqual({
			approved: undefined,
			retitled: 'written',
			afterRetitling: undefined,
		});
	});

	test('refuses to authorize when the pull reports the published record diverged', async () => {
		const { guard, cwd, branch, recordPath, before } = await setupGuard({
			record: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'], detail: 'added plan 001-local' }),
			published: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'], detail: 'added plan 001-published' }),
			syncedTo: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'], detail: 'added plan 001-last-synced' }),
			config: trackerConfig,
			env: linearEnv,
		});

		const refusal = await guard.authorize({ cwd, branch });

		expect(refusal).toEqual(expect.stringContaining('lightsout work-order sync'));
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('records the merge commit and the shipped plans on the work order state', async () => {
		const { guard, cwd, branch, recordPath } = await setupGuard({
			record: recordOf({
				plans: [...authorizedPlans, planOf({ id: '003-late-fix', excludedFor: 'superseded' })],
				shipRequest: ['001-search-basics', '002-fix-x'],
			}),
		});

		await guard.recordShipped({ cwd, branch, mergeCommit });

		const stored = readRecordAt({ recordPath });

		expect(stored).toEqual(
			expect.objectContaining({
				shipped: { at: expect.any(String), planIds: ['001-search-basics', '002-fix-x'], mergeCommit },
				history: [firstEvent, expect.objectContaining({ kind: 'shipped' })],
			}),
		);
	});

	test('records a ticket that shipped with no plans as shipped from the ticket body', async () => {
		const { guard, cwd, branch, recordPath } = await setupGuard({ record: recordOf({ mode: WorkOrderMode.SinglePlan, plans: [] }) });

		await guard.recordShipped({ cwd, branch, mergeCommit });

		const stored = readRecordAt({ recordPath });
		const shippedDetail = stored.history.at(-1)?.detail ?? '';

		expect(stored).toEqual(
			expect.objectContaining({
				shipped: { at: expect.any(String), planIds: [], mergeCommit },
				history: [firstEvent, expect.objectContaining({ kind: 'shipped', detail: expect.stringContaining(mergeCommit) })],
			}),
		);
		expect(shippedDetail).toMatch(/ticket body/);
		expect(shippedDetail.trimEnd()).not.toMatch(/with$/);
	});

	test('records nothing for a branch whose ticket has no record', async () => {
		const { guard, cwd, branch, recordPath } = await setupGuard();

		await guard.recordShipped({ cwd, branch, mergeCommit });

		expect(existsSync(recordPath)).toBe(false);
	});

	test('reports a shipped mark it could not record as a progress line without throwing', async () => {
		const { guard, cwd, branch, progress } = await setupGuard({ corrupt: true });

		await guard.recordShipped({ cwd, branch, mergeCommit });

		expect(progress).toEqual([expect.stringContaining('state.json')]);
	});

	test('leaves the record untouched and reports why when the shipped mark meets a diverged ticket', async () => {
		const { guard, cwd, branch, recordPath, before, progress } = await setupGuard({
			record: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'], detail: 'added plan 001-local' }),
			published: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'], detail: 'added plan 001-published' }),
			syncedTo: recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'], detail: 'added plan 001-last-synced' }),
			config: trackerConfig,
			env: linearEnv,
		});

		await guard.recordShipped({ cwd, branch, mergeCommit });

		// the merge happened whatever the record says, so the divergence is
		// reported rather than raised — and no half-written shipped mark is left
		expect(progress).toEqual(expect.arrayContaining([expect.stringContaining(mergeCommit)]));
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('keeps the shipped mark this machine wrote when it could not be put on the ticket', async () => {
		const record = recordOf({ plans: authorizedPlans, shipRequest: ['001-search-basics', '002-fix-x'] });
		const { guard, cwd, branch, recordPath, progress } = await setupGuard({
			record,
			published: record,
			syncedTo: record,
			config: trackerConfig,
			env: linearEnv,
		});

		await guard.recordShipped({ cwd, branch, mergeCommit });

		const stored = readRecordAt({ recordPath });

		// the local record is the working state: it carries the merge even though
		// the tracker refused the copy, and the next sync is what retries it
		expect(stored.shipped).toEqual({ at: expect.any(String), planIds: ['001-search-basics', '002-fix-x'], mergeCommit });
		expect(progress).toEqual(expect.arrayContaining([expect.stringContaining(trackerLookupFailure)]));
	});
});
