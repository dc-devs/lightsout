import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import type { GateHold } from '#src/contracts/gates/GateHold.ts';
import { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';
import { scanParkedWorktrees } from '#src/queue/worktrees/scanParkedWorktrees.ts';
import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { createWorktree } from '#src/worktree/createWorktree.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/**
 * What a tree the scan does not resume carries out with it: the hold that
 * stopped it, and the tracker's own words about its ticket.
 *
 * A sibling of `scanParkedWorktrees.unit.test.ts` rather than more cases in it:
 * that file states which bucket each tree lands in, while every case here is
 * about the entry a left-behind tree produces — a person reads that entry, so
 * what it says is a separate contract from where the tree went.
 */

// Mocked Imports
// -------------------------
// The tracker lookup and the forge read are the only two things here that would
// leave the machine, and the forge answers nothing for every branch in this
// file. Git is real, because which bucket a worktree lands in is read from git
// and nothing else, and the label-to-planning-status mapping is real because
// that is what decides whether a parked tree still has work to resume.
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketLabel = jest.fn<(params: { ticketId: string; label: string | undefined; present: boolean }) => Promise<TrackerFailure | undefined>>();
const mockFindPullRequest = jest.fn<(params: { branch: string; cwd: string; state: string }) => Promise<PullRequestSummary | undefined>>();

jest.mock('#src/ticketTracker/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
jest.mock('#src/ticketTracker/setTicketLabel.ts', () => ({
	setTicketLabel: (params: { ticketId: string; label: string | undefined; present: boolean }) => mockSetTicketLabel(params),
}));
jest.mock('#src/ship/forge/findPullRequest.ts', () => ({
	findPullRequest: (params: { branch: string; cwd: string; state: string }) => mockFindPullRequest(params),
}));
// -------------------------

mockFindPullRequest.mockResolvedValue(undefined);
mockSetTicketLabel.mockResolvedValue(undefined);

const settings = queueSettingsFixture();

/** No repository in this file has ever timed out waiting for the machine, unless a test says otherwise. */
const holds: GateHolds = {};

const trackerSettings = trackerSettingsFixture();

const ticketOf = (identifier: string, labels: string[] = ['planning-not-needed'], status = 'In Progress'): TrackerTicket => ({
	id: `id-${identifier}`,
	identifier: identifier.toUpperCase(),
	title: 'Drain the backlog',
	url: `https://linear.app/lightsout/issue/${identifier.toUpperCase()}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels,
	status,
	finished: false,
	unfinishedBlockers: [],
});

/** The sentence a gate run records when it never got the machine, which is the hold's own reason. */
const heldReason = 'its gates waited 30 minutes for the machine and never got it, so nothing was decided about the code';

/** One ticket's durable hold, as `takeGateHold` writes it once the tracker label has landed. */
const holdOf = (): GateHold => ({
	takenAt: '2026-01-02T03:04:05.000Z',
	runId: 'run-42',
	worktreePath: '/repo/.lightsout/worktrees/lo-70-drain',
	reason: heldReason,
	labelConfirmed: true,
});

/** A main checkout with one worktree per named branch, each cut from the default branch. */
const setupParkedRepo = async ({ branches }: { branches: string[] }) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const paths: Record<string, string> = {};

	for (const branch of branches) {
		// The scan finds a tree's work order by the branch its record stores, so a
		// branch shaped like a ticket's gets one written before its tree is cut. A
		// branch that carries no ticket id deliberately gets none: that is the tree
		// the scan must leave alone.
		const ticketRef = /^[a-z]+-\d+/u.exec(branch)?.[0];

		if (ticketRef !== undefined) {
			seedWorkOrderRecord({ cwd, name: branch, ticketRef });
		}

		paths[branch] = String(await createWorktree({ cwd, branch, startPoint: 'origin/main', owner: WorktreeOwner.Queue, reuseExisting: true }));
	}

	return { cwd, paths };
};

/** The scan's parked work, with the tracker-failure branch asserted away so the fields can be read. */
const scanParked = async (params: Parameters<typeof scanParkedWorktrees>[0]) => {
	const parked = await scanParkedWorktrees(params);

	if ('error' in parked) {
		throw new Error(`unexpected tracker failure: ${parked.error}`);
	}

	return parked;
};

describe('scanParkedWorktrees', () => {
	test('leaves a held tree alone with its parked label untouched', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain', 'lo-71-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70'), ticketOf('lo-71')]);

		const parked = await scanParked({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			holds: { 'lo-70': holdOf() },
			onProgress: (message) => progress.push(message),
		});

		expect(parked.leftBehind).toEqual([
			{
				identifier: 'lo-70',
				title: 'Drain the backlog',
				url: 'https://linear.app/lightsout/issue/LO-70',
				reason: expect.stringContaining('queue-blocked-gate-timed-out'),
			},
		]);
		expect(parked.leftBehind[0]?.reason).toEqual(expect.stringContaining(heldReason));
		// The unheld sibling is in the very same state, and it is resumed with its parked label cleared.
		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-71' })]);
		expect(mockSetTicketLabel.mock.calls).toEqual([[expect.objectContaining({ ticketId: 'id-lo-71', present: false })]]);
		expect(existsSync(paths['lo-70-drain'])).toBe(true);
		expect(progress).toEqual(expect.arrayContaining([expect.stringContaining('lo-70 ·')]));
	});

	test('records a held tree as unsettled work remaining', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds: { 'lo-70': holdOf() } });

		expect(parked).toEqual({
			resumed: [],
			outcomes: [],
			leftBehind: [
				{
					identifier: 'lo-70',
					title: 'Drain the backlog',
					url: 'https://linear.app/lightsout/issue/LO-70',
					reason: expect.any(String),
				},
			],
			merged: [],
		});
		expect(parked.leftBehind[0]?.settled).toBeUndefined();
	});

	test('carries the tracker’s title and link on the entry for a worktree whose ticket lost its planning status label', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		// No planning-status label, so no planning summary exists for LO-70 — only the tracker ticket does.
		mockGetTicketsByIdentifiers.mockResolvedValue([{ ...ticketOf('lo-70', ['bug']), url: 'https://linear.app/lightsout/issue/LO-70/drain-the-backlog' }]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked.leftBehind).toStrictEqual([
			{
				identifier: 'lo-70',
				title: 'Drain the backlog',
				url: 'https://linear.app/lightsout/issue/LO-70/drain-the-backlog',
				reason: `its worktree at ${paths['lo-70-drain']} is parked, but the ticket carries no planning status label any more`,
			},
		]);
	});

	test('leaves the title and link off the entry for a worktree whose ticket the tracker no longer returns', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain', 'lo-71-drain'] });

		// The tracker answers for the sibling only, so a link borrowed from another ticket would show here.
		mockGetTicketsByIdentifiers.mockResolvedValue([
			{ ...ticketOf('lo-71'), title: 'Ship the lanes', url: 'https://linear.app/lightsout/issue/LO-71/ship-the-lanes' },
		]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		// Strict, so a `title` or `url` key — even one holding undefined or an empty string — fails the match.
		expect(parked.leftBehind).toStrictEqual([
			{ identifier: 'lo-70', reason: `its worktree at ${paths['lo-70-drain']} is parked, but the ticket carries no planning status label any more` },
		]);
	});

	test('carries a held tree’s ticket title and link beside the hold’s reason', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([
			{
				...ticketOf('lo-70', ['planning-not-needed', 'queue-blocked-gate-timed-out']),
				url: 'https://linear.app/lightsout/issue/LO-70/drain-the-backlog',
			},
		]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds: { 'lo-70': holdOf() } });

		expect(parked.leftBehind).toEqual([
			{
				identifier: 'lo-70',
				title: 'Drain the backlog',
				url: 'https://linear.app/lightsout/issue/LO-70/drain-the-backlog',
				reason: expect.stringContaining(heldReason),
			},
		]);
		expect(mockSetTicketLabel).not.toHaveBeenCalled();
	});
});
