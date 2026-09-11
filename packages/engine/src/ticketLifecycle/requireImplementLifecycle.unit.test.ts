import { describe, expect, jest, test } from '@jest/globals';
import type { GateHold, LightsoutConfig } from '#src/contracts/index.ts';
import type { GateHolds } from '#src/gates/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';

// Mocked Imports
// -------------------------
// The branch read, the tracker read and the composed write each have their own
// tests. What this file owns is the guard: which planning status it settles on,
// when it declines to move a status, and what stops the pipeline.
interface LifecycleParams {
	ticketId: string;
	planningStatus?: string;
	trackerStatus?: string;
	currentStatus?: string;
}

const mockReadGitCurrentBranch = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockUpdateTicketLifecycle = jest.fn<(params: LifecycleParams) => Promise<TrackerFailure | undefined>>();
// The hold module is another module's entry point with its own tests. What this
// file owns is that the guard consults it, answers its sentence verbatim, and
// writes nothing when it says the ticket is held.
const mockSyncGateHolds = jest.fn<(params: { cwd: string; settings: TrackerSettings; onProgress?: (message: string) => void }) => Promise<GateHolds>>();
const mockIsTicketGateHeld = jest.fn<(params: { holds: GateHolds; identifier: string; labels: string[] }) => boolean>();
const mockDescribeGateHold = jest.fn<(params: { hold: GateHold | undefined; identifier: string }) => string>();

jest.mock('#src/common/git/readGitCurrentBranch.ts', () => ({ readGitCurrentBranch: (params: { cwd: string }) => mockReadGitCurrentBranch(params) }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	resolveTrackerSettings: jest.requireActual<typeof import('#src/ticketTracker/index.ts')>('#src/ticketTracker/index.ts').resolveTrackerSettings,
}));
jest.mock('#src/ticketLifecycle/updateTicketLifecycle.ts', () => ({
	updateTicketLifecycle: (params: LifecycleParams) => mockUpdateTicketLifecycle(params),
}));
jest.mock('#src/gates/index.ts', () => ({
	syncGateHolds: (params: { cwd: string; settings: TrackerSettings; onProgress?: (message: string) => void }) => mockSyncGateHolds(params),
	isTicketGateHeld: (params: { holds: GateHolds; identifier: string; labels: string[] }) => mockIsTicketGateHeld(params),
	describeGateHold: (params: { hold: GateHold | undefined; identifier: string }) => mockDescribeGateHold(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** Named inline rather than through the shared block, whose `provider` widens to `string` and would need a cast here. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' };
const config: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };
const env = { LINEAR_API_KEY: 'lin_key' };
/** A repo whose `queue` block sends two planning statuses to the same label, which no write could spell unambiguously. */
const configSharingOneLabel: LightsoutConfig = {
	gates,
	'ticket-tracker': trackerBlock,
	queue: { 'max-parallel': 1, 'planning-status-labels': { 'planning-complete': 'shaped', 'planning-not-needed': 'shaped' } },
};

const ticketWith = ({ labels, status = 'Backlog' }: { labels: string[]; status?: string }): TrackerTicket => ({
	id: 'id-88',
	identifier: 'LO-88',
	title: 'Begin source work',
	url: 'https://linear.app/lightsout/issue/LO-88',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels,
	status,
	finished: false,
	unfinishedBlockers: [],
});

/** The hold the gate reservation left behind for this branch's ticket, as the reconciler answers it. */
const heldHold: GateHold = {
	takenAt: '2026-02-14T09:30:00.000Z',
	runId: 'run-7f3a',
	worktreePath: '/repo/.worktrees/lo-88',
	reason: 'gates never started: this run waited 30m for another gate run on this machine to finish.',
	labelConfirmed: true,
};
/** The one sentence the hold module writes for every refusal site, which this guard answers verbatim. */
const heldSentence = 'lo-88 is held: run run-7f3a in /repo/.worktrees/lo-88 never got the machine — remove queue-blocked-gate-timed-out to release it';

/** A checkout on a ticket branch, whose tracker read and write answer whatever the test wants. */
const setupGuard = ({
	branch = 'lo-88-begin',
	detached = false,
	found = [ticketWith({ labels: ['planning-ready-auto-plan'] })],
	writeFailure,
	holds = {},
	held = Object.keys(holds).length > 0,
}: {
	branch?: string;
	/** A checkout sitting on no branch at all, which is what the git read answers undefined for. */
	detached?: boolean;
	found?: TrackerTicket[] | TrackerFailure;
	writeFailure?: TrackerFailure;
	/** What the reconciler answers — a hold it kept, or nothing left once a human removed the label. */
	holds?: GateHolds;
	held?: boolean;
} = {}) => {
	const progress: string[] = [];

	mockReadGitCurrentBranch.mockResolvedValue(detached ? undefined : branch);
	mockGetTicketsByIdentifiers.mockResolvedValue(found);
	mockUpdateTicketLifecycle.mockResolvedValue(writeFailure);
	mockSyncGateHolds.mockResolvedValue(holds);
	mockIsTicketGateHeld.mockReturnValue(held);
	mockDescribeGateHold.mockReturnValue(heldSentence);

	const guard = ({ ticketRef, config: given = config, silent = false }: { ticketRef?: string; config?: LightsoutConfig; silent?: boolean } = {}) =>
		requireImplementLifecycle({ cwd: '/repo', config: given, env, ticketRef, onProgress: silent ? undefined : (message: string) => progress.push(message) });

	return { guard, progress };
};

describe('requireImplementLifecycle', () => {
	test('records In Progress before the pipeline starts, which is what makes the write required rather than advisory', async () => {
		const { guard } = setupGuard();

		const refused = await guard();

		expect(refused).toBeUndefined();
		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(
			expect.objectContaining({ ticketId: 'id-88', trackerStatus: 'in-progress', currentStatus: 'Backlog' }),
		);
	});

	test('reads the branch’s own ticket reference when no --ref was typed, because implement builds whatever branch the checkout holds', async () => {
		const { guard } = setupGuard();

		await guard();

		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['lo-88'] }));
	});

	test('prefers the reference the caller was given over the branch’s', async () => {
		const { guard } = setupGuard();

		await guard({ ticketRef: 'LO-12' });

		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['LO-12'] }));
	});

	test('advances a queued auto-plan ticket to planning-complete, so it never enters In Progress claiming shaping is still owed', async () => {
		const { guard } = setupGuard();

		await guard();

		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ planningStatus: 'planning-complete' }));
	});

	test('preserves a human planning-not-needed classification, which must never be rewritten as shaped work', async () => {
		const { guard } = setupGuard({ found: [ticketWith({ labels: ['planning-not-needed'] })] });

		await guard();

		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ planningStatus: 'planning-not-needed' }));
	});

	test('settles on planning-complete for a ticket carrying two planning-status labels, rather than picking one of them', async () => {
		const { guard } = setupGuard({ found: [ticketWith({ labels: ['planning-not-needed', 'planning-complete'] })] });

		await guard();

		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ planningStatus: 'planning-complete' }));
	});

	test('leaves a ticket that already shipped at done, because moving it back would make merged work look unshipped', async () => {
		const { guard, progress } = setupGuard({ found: [ticketWith({ labels: ['planning-not-needed'], status: 'Done' })] });

		const refused = await guard();

		expect(refused).toBeUndefined();
		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ trackerStatus: undefined, planningStatus: 'planning-not-needed' }));
		expect(progress[0]).toContain("left it at 'Done'");
	});

	test('lets a repo with no tracker block start without touching anything', async () => {
		const { guard } = setupGuard();

		const refused = await guard({ config: { gates } });

		expect(refused).toBeUndefined();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('lets a branch carrying no ticket the repo’s own pattern matches start untouched — there is no ticket to refuse on behalf of', async () => {
		const { guard } = setupGuard({ branch: 'spike' });

		const refused = await guard();

		expect(refused).toBeUndefined();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('refuses the run when the tracker knows no such ticket, naming what implement records before it changes source', async () => {
		const { guard } = setupGuard({ found: [] });

		const refused = await guard();

		expect(refused).toBe('no ticket lo-88 was found on the tracker, and `lightsout implement` records In Progress before it changes any source');
	});

	test('refuses the run when the tracker cannot be read, rather than beginning work it could not record', async () => {
		const { guard } = setupGuard({ found: { error: 'linear: 500' } });

		const refused = await guard();

		expect(refused).toBe('linear: 500');
	});

	test('refuses the run when the write itself fails, and says the run stops there', async () => {
		const { guard } = setupGuard({ writeFailure: { error: "no 'In Progress' transition" } });

		const refused = await guard();

		expect(refused).toContain("lo-88 could not be moved to 'In Progress' with planning status 'planning-complete'");
		expect(refused).toContain('the run stops here');
	});

	test('keeps a ticket already carrying planning-complete at planning-complete, rather than restating what it owes', async () => {
		const { guard } = setupGuard({ found: [ticketWith({ labels: ['planning-complete'] })] });

		await guard();

		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ planningStatus: 'planning-complete' }));
	});

	test('writes without a progress reporter when the caller passes none', async () => {
		const { guard } = setupGuard();

		const refused = await guard({ silent: true });

		expect(refused).toBeUndefined();
		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'id-88', trackerStatus: 'in-progress' }));
	});

	test('lets a checkout sitting on no branch at all start untouched, since there is no branch to read a ticket from', async () => {
		const { guard } = setupGuard({ detached: true });

		const refused = await guard();

		expect(refused).toBeUndefined();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('lets the run start untouched when the repo’s own ticket pattern is not a usable expression, because no reference can be read from it', async () => {
		const { guard } = setupGuard();

		const refused = await guard({ config: { gates, 'ticket-tracker': trackerBlock, ship: { 'ticket-pattern': '(' } } });

		expect(refused).toBeUndefined();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('refuses the run when the tracker credentials are missing, without asking the tracker anything', async () => {
		const { guard } = setupGuard();

		const refused = await guard({ config: { gates, 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'MISSING_TRACKER_KEY' } } });

		expect(refused).toContain('MISSING_TRACKER_KEY');
		expect(mockUpdateTicketLifecycle).not.toHaveBeenCalled();
	});

	test('refuses the run when two planning statuses are configured onto one label, so the write can never be unambiguous', async () => {
		const { guard } = setupGuard();

		const refused = await guard({ config: configSharingOneLabel });

		expect(refused).toContain("'shaped'");
		expect(mockUpdateTicketLifecycle).not.toHaveBeenCalled();
	});

	test('refuses a held ticket before writing any lifecycle field', async () => {
		const { guard } = setupGuard({ holds: { 'lo-88': heldHold } });

		const refused = await guard();

		expect(refused).toBe(heldSentence);
		expect(mockDescribeGateHold).toHaveBeenCalledWith(expect.objectContaining({ hold: heldHold }));
		expect(mockUpdateTicketLifecycle).not.toHaveBeenCalled();
	});

	test('starts once the hold is released', async () => {
		const { guard } = setupGuard({ holds: {} });

		const refused = await guard();

		expect(refused).toBeUndefined();
		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(
			expect.objectContaining({ ticketId: 'id-88', trackerStatus: 'in-progress', currentStatus: 'Backlog' }),
		);
	});
});
