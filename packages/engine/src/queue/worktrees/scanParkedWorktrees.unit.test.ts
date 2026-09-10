import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase, type GateHold, WorktreeOwner } from '#src/contracts/index.ts';
import type { GateHolds } from '#src/gates/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { scanParkedWorktrees } from '#src/queue/worktrees/scanParkedWorktrees.ts';
import type { PullRequestSummary } from '#src/ship/index.ts';
import type { TrackerFailure, TrackerTicket } from '#src/ticketTracker/index.ts';
import { createWorktree, deleteWorktreeRecord, readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
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

const shipSettings = shipSettingsFixture();

const ticketOf = (identifier: string, labels: string[] = ['planning-not-needed'], status = 'In Progress'): TrackerTicket => ({
	id: `id-${identifier}`,
	identifier: identifier.toUpperCase(),
	title: 'Drain the backlog',
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
		paths[branch] = String(await createWorktree({ cwd, branch, defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true }));
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

describe('scanParkedWorktrees', () => {
	test('answers nothing when no drain has left a worktree behind, without asking the tracker anything', async () => {
		const { cwd } = setupBranchRepo();

		expect(await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds })).toStrictEqual({
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

		const parked = await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

		expect(parked).toEqual({ resumed: [expect.objectContaining({ identifier: 'LO-70' })], outcomes: [], leftBehind: [], merged: [] });
		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['lo-70'] }));
	});

	test('sends a clean, committed worktree straight to the merge — re-running its worker would spend an agent on finished work', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });

		const parked = await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

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

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

		expect(parked.resumed).toHaveLength(1);
		expect(parked.outcomes).toStrictEqual([]);
	});

	test('parks a worktree git cannot read at all, rather than guessing which bucket it belongs in', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		rmSync(paths['lo-70-drain'], { recursive: true, force: true });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

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
			shipSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked.resumed).toStrictEqual([]);
		expect(parked.leftBehind).toEqual([{ identifier: 'lo-70', reason: expect.stringContaining('no planning status label any more') }]);
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
			shipSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked.resumed).toStrictEqual([]);
		expect(parked.leftBehind).toEqual([{ identifier: 'lo-70', reason: expect.stringContaining("'planning-needs-plan'") }]);
		expect(progress).toEqual([expect.stringContaining('lo-70 ·')]);
	});

	test('reads the branch from git rather than the directory name, so a nested branch template still resolves its ticket', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

		expect(parked.resumed[0]?.identifier).toBe('LO-70');
	});

	test('skips a tree whose branch carries no ticket the pattern matches, naming the path and touching nothing', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['scratch-work'] });
		const progress: string[] = [];

		const parked = await scanParkedWorktrees({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			shipSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked).toStrictEqual({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
		expect(progress).toEqual([expect.stringContaining('carries no ticket the configured pattern matches')]);
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
			shipSettings,
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

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
		expect(parked.outcomes).toEqual([expect.objectContaining({ branch: 'lo-70-drain', worktreePath: paths['lo-70-drain'], ready: true })]);
		expect(parked.leftBehind).toStrictEqual([]);
	});

	test('carries a worktree whose branch is recorded merged, without resuming it or removing anything', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Merged });

		const parked = await scanParked({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			shipSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		expect(parked.merged).toEqual([{ worktreePath: paths['lo-70-drain'], branch: 'lo-70-drain', ticket: expect.objectContaining({ identifier: 'LO-70' }) }]);
		expect(parked.resumed).toStrictEqual([]);
		expect(parked.outcomes).toStrictEqual([]);
		// The scan runs before the run lock, so removing the tree is the drain's job.
		expect(existsSync(paths['lo-70-drain'])).toBe(true);
		expect(progress).toEqual([expect.stringContaining('recorded merged')]);
	});

	test('sends a worktree recorded ready to the merge though its branch carries no commits git could count', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Ready });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

		// A git count would answer zero here and drain it; the record is what decides.
		expect(parked.outcomes).toEqual([expect.objectContaining({ worktreePath: paths['lo-70-drain'], ready: true })]);
		expect(parked.resumed).toStrictEqual([]);
	});

	test('sends a worktree recorded building back through the drain though its branch already carries commits', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });
		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(parked.outcomes).toStrictEqual([]);
	});

	test('records what it found for an unrecorded branch, so a second scan needs no git count', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds });

		expect(parked.outcomes).toEqual([expect.objectContaining({ ready: true })]);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Ready }));
	});

	test('records nothing for an unrecorded branch git could not count, so a later scan still asks', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		// `origin/no-such-default` does not exist, so `rev-list --count` refuses.
		const parked = await scanParked({ cwd, defaultBranch: 'no-such-default', settings, trackerSettings, shipSettings, holds });

		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});

	test('hands a tracker failure back, so a restart stops rather than reading every parked tree as withdrawn', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue({ error: 'authentication failed' });

		expect(await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds })).toStrictEqual({
			error: 'authentication failed',
		});
	});

	test('leaves a held tree alone with its parked label untouched', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain', 'lo-71-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70'), ticketOf('lo-71')]);

		const parked = await scanParked({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			shipSettings,
			holds: { 'lo-70': holdOf() },
			onProgress: (message) => progress.push(message),
		});

		expect(parked.leftBehind).toEqual([{ identifier: 'lo-70', reason: expect.stringContaining('queue-blocked-gate-timed-out') }]);
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

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds: { 'lo-70': holdOf() } });

		expect(parked).toEqual({ resumed: [], outcomes: [], leftBehind: [{ identifier: 'lo-70', reason: expect.any(String) }], merged: [] });
		expect(parked.leftBehind[0]?.settled).toBeUndefined();
	});
});
