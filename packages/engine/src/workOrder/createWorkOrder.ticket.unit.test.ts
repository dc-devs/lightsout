import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { createWorkOrder } from '#src/workOrder/createWorkOrder.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';

// Mocked Imports
// -------------------------
// Only the tracker request is mocked. `resolveTrackerSettings` stays the real
// one, because the refusal a repository with no `ticket-tracker` block gets is
// the very thing the first test reads — a hand-written stand-in would assert
// this file's own sentence back at itself.
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** A config with no `ticket-tracker` block at all — the tracker-free repository the design calls the normal case. */
const trackerFreeConfig: LightsoutConfig = { gates };
/** The same config with a Linear tracker named, paired with the environment variable that block points at. */
const trackerConfig: LightsoutConfig = { gates, 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } };
const env = { LINEAR_API_KEY: 'lin_key' };

/** One tracker issue as the tracker itself spells it — the reference in upper case and a sentence-length title. */
const trackerTicket = (): TrackerTicket => ({
	id: 'id-158',
	identifier: 'LO-158',
	title: "A ticket's branch name has no single author",
	url: 'https://linear.app/lightsout/issue/LO-158',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
});

/**
 * A temporary checkout, a stub harness that records every spawn it is handed,
 * and the tracker's answer to the one reference these tests use.
 *
 * The harness is a recording stub in every case, including the two where no
 * spawn is expected: a driver that threw would be swallowed by the
 * summariser's fallback, where an empty recording cannot be.
 */
const setupCreateWorkOrder = ({
	config = trackerFreeConfig,
	ticket,
	words = 'give-the-name-one',
}: {
	config?: LightsoutConfig;
	ticket?: TrackerTicket;
	words?: string;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-new-'));
	const invocations: DriverInvocation[] = [];
	const progress: string[] = [];
	const summarizer: Driver = { name: 'stub', invoke: async () => ({ text: JSON.stringify({ words }), exitCode: 0 }) };

	mockGetTicketsByIdentifiers.mockResolvedValue(ticket === undefined ? { error: 'the tracker answered no such ticket' } : [ticket]);

	return {
		cwd,
		invocations,
		progress,
		args: {
			cwd,
			config,
			env,
			driver: recordingDriver({ driver: summarizer, invocations }),
			onProgress: (message: string) => {
				progress.push(message);
			},
		},
	};
};

/** The record one work order's folder holds, read back as the plain JSON on disk. */
const readRecord = ({ cwd, name }: { cwd: string; name: string }): unknown =>
	JSON.parse(readFileSync(join(cwd, '.lightsout', 'work-orders', name, 'state.json'), 'utf8'));

test('createWorkOrder: --ticket with no ticket-tracker block refuses, spawning no harness and writing nothing', async () => {
	const { cwd, invocations, args } = setupCreateWorkOrder({ config: trackerFreeConfig });

	const created = await createWorkOrder({ ...args, ticketRef: 'LO-158' });

	expect(created).toEqual({ error: expect.stringContaining('ticket-tracker') });
	expect(invocations).toStrictEqual([]);
	expect(existsSync(join(cwd, '.lightsout', 'work-orders'))).toBe(false);
});

test("createWorkOrder: --ticket reads the title, summarises it, and records the tracker's own spelling of the reference", async () => {
	const { cwd, invocations, args } = setupCreateWorkOrder({ config: trackerConfig, ticket: trackerTicket(), words: 'give-the-name-one' });

	const created = await createWorkOrder({ ...args, ticketRef: 'lo-158' });

	expect(created).toEqual(expect.objectContaining({ name: 'lo-158-give-the-name-one', branch: 'lo-158-give-the-name-one' }));
	// one spawn, and the title it summarised came from the tracker rather than the caller
	expect(invocations.length).toBe(1);
	expect(invocations[0]?.prompt).toContain("A ticket's branch name has no single author");
	expect(readRecord({ cwd, name: 'lo-158-give-the-name-one' })).toEqual(
		expect.objectContaining({ name: 'lo-158-give-the-name-one', branch: 'lo-158-give-the-name-one', ticketRef: 'LO-158' }),
	);
});

test('createWorkOrder: --title spawns no harness, because the words were already typed', async () => {
	const { cwd, invocations, args } = setupCreateWorkOrder({ config: trackerConfig });

	const created = await createWorkOrder({ ...args, title: 'Add search basics' });

	expect(created).toEqual(expect.objectContaining({ name: 'add-search-basics' }));
	expect(invocations).toStrictEqual([]);
	const record = readRecord({ cwd, name: 'add-search-basics' }) as object;

	// `objectContaining` would need the key to be present, and `JSON.stringify`
	// drops an undefined value — so absence is asserted the way
	// `buildWorkOrderState.unit.test.ts` spells it.
	expect({ record, carriesTicketRef: Object.hasOwn(record, 'ticketRef') }).toEqual({
		record: expect.objectContaining({ name: 'add-search-basics' }),
		carriesTicketRef: false,
	});
});
