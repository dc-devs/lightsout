import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';

// Mocked Imports
// -------------------------
// The tracker read and the composed write are each covered by their own tests.
// What this file owns is which of them run at all, and the sentence each
// failure becomes — none of which may ever look like a failed ship.
interface LifecycleParams {
	ticketId: string;
	planningStatus?: string;
	trackerStatus?: string;
	currentStatus?: string;
}

const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockUpdateTicketLifecycle = jest.fn<(params: LifecycleParams) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	resolveTrackerSettings: jest.requireActual<typeof import('#src/ticketTracker/index.ts')>('#src/ticketTracker/index.ts').resolveTrackerSettings,
}));
jest.mock('#src/ticketLifecycle/updateTicketLifecycle.ts', () => ({
	updateTicketLifecycle: (params: LifecycleParams) => mockUpdateTicketLifecycle(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** Named inline rather than through the shared block, whose `provider` widens to `string` and would need a cast here. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' };

const config: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };

/** A repo that calls its done status something other than the default. */
const renamedDoneConfig: LightsoutConfig = {
	gates,
	'ticket-tracker': trackerBlock,
	queue: { 'max-parallel': 1, 'done-status': 'Shipped' },
};

/** Two planning statuses spelled with one label — the arrangement the lifecycle resolver refuses. */
const duplicateLabelConfig: LightsoutConfig = {
	gates,
	'ticket-tracker': trackerBlock,
	queue: { 'max-parallel': 1, 'planning-status-labels': { 'planning-complete': 'shaped', 'planning-not-needed': 'shaped' } },
};

const ticket: TrackerTicket = {
	id: 'id-88',
	identifier: 'LO-88',
	title: 'Reconcile a shipped ticket',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: ['planning-not-needed'],
	status: 'In Progress',
	unfinishedBlockers: [],
};

const env = { LINEAR_API_KEY: 'lin_key' };

/** A repo with a tracker configured, whose read and write answer whatever the test wants. */
const setupReconcile = ({
	config: given = config,
	env: givenEnv = env,
	found = [ticket],
	writeFailure,
}: {
	config?: LightsoutConfig;
	env?: NodeJS.ProcessEnv;
	found?: TrackerTicket[] | TrackerFailure;
	writeFailure?: TrackerFailure;
} = {}) => {
	const progress: string[] = [];

	mockGetTicketsByIdentifiers.mockResolvedValue(found);
	mockUpdateTicketLifecycle.mockResolvedValue(writeFailure);

	// The default is on the whole object rather than on the property, so a test
	// can hand the reference through as genuinely absent.
	const reconcile = ({ ticketRef }: { ticketRef?: string } = { ticketRef: 'LO-88' }) =>
		reconcileShippedTicket({ config: given, env: givenEnv, ticketRef, onProgress: (message) => progress.push(message) });

	return { reconcile, progress };
};

describe('reconcileShippedTicket', () => {
	test('moves the shipped ticket to done by naming the role, so the repository’s own spelling is resolved in one place', async () => {
		const { reconcile } = setupReconcile();

		const failure = await reconcile();

		expect(failure).toBeUndefined();
		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'id-88', trackerStatus: 'done', currentStatus: 'In Progress' }));
	});

	test('writes no planning status, because a merge says nothing about what preparation the work needed', async () => {
		const { reconcile } = setupReconcile();

		await reconcile();

		expect(mockUpdateTicketLifecycle.mock.calls[0]?.[0]).not.toHaveProperty('planningStatus');
	});

	test('announces the move, so a drain reader sees the tracker caught up without opening it', async () => {
		const { reconcile, progress } = setupReconcile();

		await reconcile();

		expect(progress).toStrictEqual(["LO-88 · moved to 'Done'"]);
	});

	test('announces the repository’s own spelling of done, rather than the default one', async () => {
		const { reconcile, progress } = setupReconcile({ config: renamedDoneConfig });

		const failure = await reconcile();

		expect(failure).toBeUndefined();
		expect(progress).toStrictEqual(["LO-88 · moved to 'Shipped'"]);
	});

	test('does nothing at all for a repo with no tracker block, which never asked for reconciliation', async () => {
		const { reconcile } = setupReconcile({ config: { gates } });

		const failure = await reconcile({ ticketRef: undefined });

		expect(failure).toBeUndefined();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('says a branch carried no ticket reference, once a tracker is actually configured', async () => {
		const { reconcile } = setupReconcile();

		const failure = await reconcile({ ticketRef: undefined });

		expect(failure).toContain('no ticket reference');
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('turns unreachable tracker credentials into a sentence, and reads no ticket it has no key to read', async () => {
		const { reconcile } = setupReconcile({ env: {} });

		const failure = await reconcile();

		expect(failure).toContain('LO-88 shipped, but the tracker could not be reached to move it to Done:');
		expect(failure).toContain('LINEAR_API_KEY');
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('turns unresolvable lifecycle settings into a sentence, before any ticket is read', async () => {
		const { reconcile } = setupReconcile({ config: duplicateLabelConfig });

		const failure = await reconcile();

		expect(failure).toContain('LO-88 shipped, but the lifecycle settings could not be resolved to move it to Done:');
		expect(failure).toContain('shaped');
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('turns a tracker read failure into a sentence rather than an exception, because a raised error would look like a failed ship', async () => {
		const { reconcile } = setupReconcile({ found: { error: 'linear: 500' } });

		const failure = await reconcile();

		expect(failure).toBe('LO-88 shipped, but the tracker could not be read to move it to Done: linear: 500');
	});

	test('says so when the tracker knows no ticket by that reference', async () => {
		const { reconcile } = setupReconcile({ found: [] });

		const failure = await reconcile();

		expect(failure).toBe('LO-88 shipped, but the tracker returned no ticket with that identifier, so it could not be moved to Done');
	});

	test('carries the tracker’s own refusal of the done write, naming the status the repo spells it with', async () => {
		const { reconcile } = setupReconcile({ writeFailure: { error: "no 'Done' transition" } });

		const failure = await reconcile();

		expect(failure).toBe("LO-88 shipped, but its tracker status could not be moved to 'Done': no 'Done' transition");
	});
});
