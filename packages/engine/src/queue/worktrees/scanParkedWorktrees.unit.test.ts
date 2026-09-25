import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';
import { scanParkedWorktrees } from '#src/queue/worktrees/scanParkedWorktrees.ts';
import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { createWorktree } from '#src/worktree/createWorktree.ts';
import { deleteWorktreeRecord } from '#src/worktree/records/deleteWorktreeRecord.ts';
import { readWorktreeRecord } from '#src/worktree/records/readWorktreeRecord.ts';
import { writeWorktreeRecord } from '#src/worktree/records/writeWorktreeRecord.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

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

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	setTicketLabel: (params: { ticketId: string; label: string | undefined; present: boolean }) => mockSetTicketLabel(params),
}));
jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
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

/** Commit something on this worktree's branch, which is what "parked at the ship step" looks like. */
const commitWork = ({ path }: { path: string }) => {
	writeFileSync(join(path, 'work.ts'), 'export const value = 1;\n');
	execSync('git config user.name t && git config user.email t@t && git add -A && git commit -qm work', { cwd: path, stdio: 'ignore' });
};

/**
 * A state the work-order contract accepts, written by hand so the scan's
 * look-up is the only thing under test. `branch` is stated apart from `name`,
 * and `ticketRef` apart from both, because none of the three is ever derived
 * from another.
 */
const workOrderStateOf = ({ name, branch, ticketRef }: { name: string; branch: string; ticketRef: string }) => ({
	schemaVersion: 1,
	name,
	branch,
	ticketRef,
	mode: 'multiple-plan',
	plans: [],
	history: [],
});

/**
 * A main checkout holding one work-order record per entry, then one worktree
 * per branch. The records are written before any tree is cut, so each tree
 * lands where its work order's label puts it.
 */
const setupClaimedRepo = async ({ workOrders, branches }: { workOrders: { name: string; branch: string; ticketRef: string }[]; branches: string[] }) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	for (const workOrder of workOrders) {
		const folder = join(cwd, '.lightsout', 'work-orders', workOrder.name);

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf(workOrder)));
	}

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

describe('scanParkedWorktrees', () => {
	test('answers nothing when no drain has left a worktree behind, without asking the tracker anything', async () => {
		const { cwd } = setupBranchRepo();

		expect(await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, holds })).toStrictEqual({
			resumed: [],
			outcomes: [],
			leftBehind: [],
			merged: [],
		});
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('sends a dirty worktree back through the drain, so its worker continues in place', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		writeFileSync(join(paths['lo-70-drain'], 'half-done.ts'), 'export const value = 1;\n');

		const parked = await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked).toEqual({ resumed: [expect.objectContaining({ identifier: 'LO-70' })], outcomes: [], leftBehind: [], merged: [] });
		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['lo-70'] }));
	});

	test('sends a clean, committed worktree straight to the merge — re-running its worker would spend an agent on finished work', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });

		const parked = await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked).toEqual({
			resumed: [],
			outcomes: [expect.objectContaining({ branch: 'lo-70-drain', worktreePath: paths['lo-70-drain'], ready: true })],
			leftBehind: [],
			merged: [],
		});
	});

	test('sends a clean worktree with nothing committed back through the drain — that is a tree where nothing happened', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked.resumed).toHaveLength(1);
		expect(parked.outcomes).toStrictEqual([]);
	});

	test('parks a worktree git cannot read at all, rather than guessing which bucket it belongs in', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		rmSync(paths['lo-70-drain'], { recursive: true, force: true });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked.outcomes).toEqual([expect.objectContaining({ ready: false, error: expect.stringContaining('git could not read the worktree') })]);
	});

	test('leaves a worktree alone once its ticket has lost every planning status label — a removed label is the user withdrawing the automation', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70', ['bug'])]);

		const parked = await scanParked({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked.resumed).toStrictEqual([]);
		expect(parked.leftBehind).toEqual([
			{
				identifier: 'lo-70',
				title: 'Drain the backlog',
				url: 'https://linear.app/lightsout/issue/LO-70',
				reason: expect.stringContaining('no planning status label any more'),
			},
		]);
		expect(progress).toEqual([expect.stringContaining('lo-70 ·')]);
	});

	test('leaves a worktree alone once its ticket carries a shaping status the queue never resumes, naming the label found', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70', ['planning-needs-plan'])]);

		const parked = await scanParked({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked.resumed).toStrictEqual([]);
		expect(parked.leftBehind).toEqual([
			{
				identifier: 'lo-70',
				title: 'Drain the backlog',
				url: 'https://linear.app/lightsout/issue/LO-70',
				reason: expect.stringContaining("'planning-needs-plan'"),
			},
		]);
		expect(progress).toEqual([expect.stringContaining('lo-70 ·')]);
	});

	test('reads the branch from git rather than the directory name, so a nested branch template still resolves its ticket', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked.resumed[0]?.identifier).toBe('LO-70');
	});

	test('skips a tree no work order claims, naming the path and touching nothing', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['scratch-work'] });
		const progress: string[] = [];

		const parked = await scanParkedWorktrees({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked).toStrictEqual({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
		expect(progress).toEqual([expect.stringContaining("no work order's record stores its branch")]);
	});

	test('leaves a parked tree alone when its record names an owner other than the queue', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });
		const progress: string[] = [];

		// A tracker that would answer for LO-70, so "never asked" is a choice the scan made rather than an absence.
		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		await writeWorktreeRecord({ cwd, branch: 'lo-70-drain', owner: WorktreeOwner.Implement, worktreePath: paths['lo-70-drain'] });

		const parked = await scanParkedWorktrees({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked).toStrictEqual({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
		expect(existsSync(paths['lo-70-drain'])).toBe(true);
		expect(progress).toEqual([expect.stringContaining(paths['lo-70-drain'])]);
	});

	test('still adopts a parked tree that carries no ownership record', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });
		// A tree an earlier drain made before ownership was ever recorded.
		await deleteWorktreeRecord({ cwd, branch: 'lo-70-drain' });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
		expect(parked.outcomes).toEqual([expect.objectContaining({ branch: 'lo-70-drain', worktreePath: paths['lo-70-drain'], ready: true })]);
		expect(parked.leftBehind).toStrictEqual([]);
	});

	test('hands a tracker failure back, so a restart stops rather than reading every parked tree as withdrawn', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue({ error: 'authentication failed' });

		expect(await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, holds })).toStrictEqual({
			error: 'authentication failed',
		});
	});

	test("finds each parked tree's work order by its branch, and leaves an unclaimed tree alone", async () => {
		const { cwd, paths } = await setupClaimedRepo({
			// A label the branch does not spell, on a branch carrying no ticket id
			// at all: only the record can answer either question.
			workOrders: [{ name: 'lo-70-drain', branch: 'drain-the-backlog', ticketRef: 'LO-70' }],
			branches: ['drain-the-backlog', 'scratch-work'],
		});
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds, onProgress: (message) => progress.push(message) });

		const unclaimed = progress.filter((line) => line.includes(paths['scratch-work']));

		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['LO-70'] }));
		expect(unclaimed).toEqual([expect.stringContaining('work order')]);
		expect(parked.leftBehind).toStrictEqual([]);
		expect(parked.outcomes).toStrictEqual([]);
	});
});
