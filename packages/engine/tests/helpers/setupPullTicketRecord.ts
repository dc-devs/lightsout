import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { jest } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import { canonicalTicketRecordText } from '#tests/helpers/canonicalTicketRecordText.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

type TrackerFailure = { error: string };

/**
 * The two reads a pull test doubles in its own `jest.mock` block and hands here,
 * so this fixture can arrange what each one answers.
 *
 * They are the only calls that would touch the network; the record contract, the
 * byte form, the lock and the sidecar writer stay real.
 */
interface PullTicketRecordMocks {
	getTicketAttachments: jest.Mock<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>;
	readTicketAsset: jest.Mock<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>;
}

/** The ticket's own side of an arrangement: what it carries, and how it refuses to answer. */
interface TicketSide {
	/** The record the ticket carries as `state.json`. */
	published?: WorkOrderState;
	/** Raw text for the published `state.json`, for the rows where it is not a valid record. */
	publishedText?: string;
	/** Whether the ticket carries the published `state.json` twice over. */
	publishedTwice?: boolean;
	/** The sentence the tracker refuses the attachment list with. */
	listFailure?: string;
	/** The sentence the tracker refuses the read of the attachment's own bytes with. */
	assetFailure?: string;
}

interface Params {
	mocks: PullTicketRecordMocks;
	/** The record already in the primary checkout, or none. */
	local?: WorkOrderState;
	/** The record whose bytes the sidecar names as last published or restored. No sidecar when absent. */
	syncedTo?: WorkOrderState;
	/** What the ticket itself answers with. Nothing at all is a ticket carrying no record. */
	ticket?: TicketSide;
	config?: LightsoutConfig;
	env?: NodeJS.ProcessEnv;
	branch?: string;
}

/** The arrangement a row reads back: where each file landed, its bytes, and what to hand the pull. */
interface PullTicketRecordFixture {
	recordPath: string;
	syncPath: string;
	publishedPath: string;
	localBytes: string | undefined;
	syncBytes: string | undefined;
	params: { cwd: string; name: string; config: LightsoutConfig; env: NodeJS.ProcessEnv; onProgress: (message: string) => void };
}

const assetUrl = 'https://uploads.example.com/state.json';
const defaultBranch = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The shared fixture typed: the raw JSON shape widens `provider` to `string`. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const configWithTracker: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };
const linearEnv = { LINEAR_API_KEY: 'lin_key' };

/**
 * A checkout outside any repository, so the shared state directory is its own
 * and the ticket folder is a path the row can name: a local record seeded
 * through the store, a sidecar naming the bytes of whichever record last
 * synced, and whatever the ticket carries.
 */
export const setupPullTicketRecord = async ({
	mocks,
	local,
	syncedTo,
	ticket = {},
	config = configWithTracker,
	env = linearEnv,
	branch = defaultBranch,
}: Params): Promise<PullTicketRecordFixture> => {
	const { published, publishedText, publishedTwice = false, listFailure, assetFailure } = ticket;
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-pull-ticket-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', branch);
	const recordPath = join(workOrderFolder, 'state.json');
	const syncPath = join(workOrderFolder, 'state-sync.json');
	const publishedPath = join(workOrderFolder, 'state.published.json');
	const text = publishedText ?? (published === undefined ? undefined : JSON.stringify(published));
	const carried: TrackerAttachment[] = text === undefined ? [] : [{ id: 'att-1', title: 'state.json', url: assetUrl }];

	if (publishedTwice) {
		carried.push({ id: 'att-2', title: 'state.json', url: `${assetUrl}?second` });
	}

	mocks.getTicketAttachments.mockResolvedValue(listFailure === undefined ? carried : { error: listFailure });
	mocks.readTicketAsset.mockResolvedValue(assetFailure === undefined ? (text ?? { error: 'the attachment could not be read' }) : { error: assetFailure });

	if (local !== undefined) {
		const seeded = await updateLocalWorkOrderState({ cwd, name: branch, change: () => local });

		if ('error' in seeded) {
			throw new Error(seeded.error);
		}
	}

	if (syncedTo !== undefined) {
		mkdirSync(workOrderFolder, { recursive: true });
		writeFileSync(
			syncPath,
			JSON.stringify({ schemaVersion: 1, recordSha256: sha256({ content: await canonicalTicketRecordText({ record: syncedTo }) }), planMarkers: {} }),
		);
	}

	return {
		recordPath,
		syncPath,
		publishedPath,
		localBytes: local === undefined ? undefined : readFileSync(recordPath).toString('utf8'),
		syncBytes: syncedTo === undefined ? undefined : readFileSync(syncPath).toString('utf8'),
		params: { cwd, name: branch, config, env, onProgress: () => undefined },
	};
};
