import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { pullWorkOrderState } from '#src/workOrder/pullWorkOrderState.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Only the two reads that would touch the network are doubled, as in the pull's
// own suite. What these rows are about is the work order folder on disk, so the
// record contract, the byte form, the lock and the sidecar writer are all real.
type TrackerFailure = { error: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/getTicketAttachments.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
}));
jest.mock('#src/ticketTracker/readTicketAsset.ts', () => ({
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

/** The work order's label, which is also the branch the published record names. */
const name = 'lo-140-multi';
const assetUrl = 'https://uploads.example.com/state.json';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The shared fixture typed: the raw JSON shape widens `provider` to `string`. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const config: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };
const env = { LINEAR_API_KEY: 'lin_key' };

/** The record the ticket carries, which every row here can read without trouble. */
const publishedRecord: WorkOrderState = {
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: WorkOrderMode.SinglePlan,
	plans: [],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added plan 001-record' }],
};

/**
 * A checkout outside any repository, whose work order folder holds a directory where
 * one of its own files belongs — the one way to make a real read or a real write
 * of that file fail without doubling the filesystem underneath the pull.
 */
const setupBlockedTicketFolder = async ({ blocked, seedLocal = false }: { blocked: 'state.json' | 'state-sync.json'; seedLocal?: boolean }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-pull-folder-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);

	// The record is what says which ticket a work order belongs to, so a row that
	// needs the tracker reached at all has to hold one.
	if (seedLocal) {
		const seeded = await updateLocalWorkOrderState({ cwd, name, change: () => publishedRecord });

		if ('error' in seeded) {
			throw new Error(seeded.error);
		}
	}

	mkdirSync(join(workOrderFolder, blocked), { recursive: true });
	mockGetTicketAttachments.mockResolvedValue([{ id: 'att-1', title: 'state.json', url: assetUrl }]);
	mockReadTicketAsset.mockResolvedValue(JSON.stringify(publishedRecord));

	return { workOrderFolder, params: { cwd, name, config, env } };
};

/** The refusal an answer carries, so a row can read one sentence out of the union. */
const errorOf = (answer: { record: WorkOrderState | undefined } | { error: string }) => ('error' in answer ? answer.error : undefined);

describe('pullWorkOrderState', () => {
	test("pullWorkOrderState: refuses when this machine's own state.json cannot be read, rather than taking the published copy over it", async () => {
		const { workOrderFolder, params } = await setupBlockedTicketFolder({ blocked: 'state.json' });

		const pulled = await pullWorkOrderState(params);

		expect({ error: errorOf(pulled), remembered: existsSync(join(workOrderFolder, 'state-sync.json')) }).toEqual({
			error: expect.stringContaining(join(workOrderFolder, 'state.json')),
			remembered: false,
		});
	});

	test('pullWorkOrderState: answers one sentence when the record it took could not be recorded as the last synced one', async () => {
		const { workOrderFolder, params } = await setupBlockedTicketFolder({ blocked: 'state-sync.json', seedLocal: true });

		const pulled = await pullWorkOrderState(params);

		// The bytes did land — what failed is this machine's memory of taking them,
		// and saying so is what lets the next sync offer them again.
		expect({ error: errorOf(pulled), taken: JSON.parse(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')) }).toEqual({
			error: expect.stringContaining(workOrderFolder),
			taken: publishedRecord,
		});
	});
});
