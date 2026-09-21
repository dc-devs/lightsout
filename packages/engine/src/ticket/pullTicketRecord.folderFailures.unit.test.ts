import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { pullTicketRecord } from '#src/ticket/index.ts';
import type { TrackerAttachment, TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Only the two reads that would touch the network are doubled, as in the pull's
// own suite. What these rows are about is the ticket folder on disk, so the
// record contract, the byte form, the lock and the sidecar writer are all real.
type TrackerFailure = { error: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketTracker/index.ts')>('#src/ticketTracker/index.ts'),
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch the published record names. */
const ticketBranch = 'lo-140-multi';
const assetUrl = 'https://uploads.example.com/ticket.json';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The shared fixture typed: the raw JSON shape widens `provider` to `string`. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const config: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };
const env = { LINEAR_API_KEY: 'lin_key' };

/** The record the ticket carries, which every row here can read without trouble. */
const publishedRecord: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode: TicketMode.SinglePlan,
	plans: [],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail: 'added plan 001-record' }],
};

/**
 * A checkout outside any repository, whose ticket folder holds a directory where
 * one of its own files belongs — the one way to make a real read or a real write
 * of that file fail without doubling the filesystem underneath the pull.
 */
const setupBlockedTicketFolder = ({ blocked }: { blocked: 'ticket.json' | 'ticket-sync.json' }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-pull-folder-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);

	mkdirSync(join(ticketFolder, blocked), { recursive: true });
	mockGetTicketAttachments.mockResolvedValue([{ id: 'att-1', title: 'ticket.json', url: assetUrl }]);
	mockReadTicketAsset.mockResolvedValue(JSON.stringify(publishedRecord));

	return { ticketFolder, params: { cwd, ticketBranch, config, env } };
};

/** The refusal an answer carries, so a row can read one sentence out of the union. */
const errorOf = (answer: { record: TicketRecord | undefined } | { error: string }) => ('error' in answer ? answer.error : undefined);

describe('pullTicketRecord', () => {
	test("pullTicketRecord: refuses when this machine's own ticket.json cannot be read, rather than taking the published copy over it", async () => {
		const { ticketFolder, params } = setupBlockedTicketFolder({ blocked: 'ticket.json' });

		const pulled = await pullTicketRecord(params);

		expect({ error: errorOf(pulled), remembered: existsSync(join(ticketFolder, 'ticket-sync.json')) }).toEqual({
			error: expect.stringContaining(join(ticketFolder, 'ticket.json')),
			remembered: false,
		});
	});

	test('pullTicketRecord: answers one sentence when the record it took could not be recorded as the last synced one', async () => {
		const { ticketFolder, params } = setupBlockedTicketFolder({ blocked: 'ticket-sync.json' });

		const pulled = await pullTicketRecord(params);

		// The bytes did land — what failed is this machine's memory of taking them,
		// and saying so is what lets the next sync offer them again.
		expect({ error: errorOf(pulled), taken: JSON.parse(readFileSync(join(ticketFolder, 'ticket.json'), 'utf8')) }).toEqual({
			error: expect.stringContaining(ticketFolder),
			taken: publishedRecord,
		});
	});
});
