import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { createTicketWorktree } from '#src/queue/createTicketWorktree.ts';
import { scanParkedWorktrees } from '#src/queue/scanParkedWorktrees.ts';
import type { TrackerFailure, TrackerTicket } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker lookup is the only thing here that would leave the machine. Git is
// real, because which bucket a worktree lands in is read from git and nothing
// else, and the label-to-planning-status mapping is real because that is what
// decides whether a parked tree still has work to resume.
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	setParkedLabel: () => Promise.resolve(undefined),
}));
// -------------------------

const settings = queueSettingsFixture();

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
	unfinishedBlockers: [],
});

/** A main checkout with one worktree per named branch, each cut from the default branch. */
const setupParkedRepo = async ({ branches }: { branches: string[] }) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const paths: Record<string, string> = {};

	for (const branch of branches) {
		paths[branch] = String(await createTicketWorktree({ cwd, branch, defaultBranch: 'main' }));
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

		expect(await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings })).toStrictEqual({
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

		const parked = await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

		expect(parked).toEqual({ resumed: [expect.objectContaining({ identifier: 'LO-70' })], outcomes: [], leftBehind: [], merged: [] });
		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['lo-70'] }));
	});

	test('sends a clean, committed worktree straight to the merge — re-running its worker would spend an agent on finished work', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });

		const parked = await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

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

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

		expect(parked.resumed).toHaveLength(1);
		expect(parked.outcomes).toStrictEqual([]);
	});

	test('parks a worktree git cannot read at all, rather than guessing which bucket it belongs in', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		rmSync(paths['lo-70-drain'], { recursive: true, force: true });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

		expect(parked.outcomes).toEqual([expect.objectContaining({ ready: false, error: expect.stringContaining('git could not read the worktree') })]);
	});

	test('leaves a worktree alone once its ticket has lost every planning status label — a removed label is the user withdrawing the automation', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70', ['bug'])]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, onProgress: (message) => progress.push(message) });

		expect(parked.resumed).toStrictEqual([]);
		expect(parked.leftBehind).toEqual([{ identifier: 'lo-70', reason: expect.stringContaining('no planning status label any more') }]);
		expect(progress).toEqual([expect.stringContaining('lo-70 ·')]);
	});

	test('leaves a worktree alone once its ticket carries a shaping status the queue never resumes, naming the label found', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70', ['planning-needs-plan'])]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, onProgress: (message) => progress.push(message) });

		expect(parked.resumed).toStrictEqual([]);
		expect(parked.leftBehind).toEqual([{ identifier: 'lo-70', reason: expect.stringContaining("'planning-needs-plan'") }]);
		expect(progress).toEqual([expect.stringContaining('lo-70 ·')]);
	});

	test('reads the branch from git rather than the directory name, so a nested branch template still resolves its ticket', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

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
			onProgress: (message) => progress.push(message),
		});

		expect(parked).toStrictEqual({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
		expect(progress).toEqual([expect.stringContaining('carries no ticket the configured pattern matches')]);
	});

	test('carries a worktree whose branch is recorded merged, without resuming it or removing anything', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });
		const progress: string[] = [];

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Merged });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, onProgress: (message) => progress.push(message) });

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

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

		// A git count would answer zero here and drain it; the record is what decides.
		expect(parked.outcomes).toEqual([expect.objectContaining({ worktreePath: paths['lo-70-drain'], ready: true })]);
		expect(parked.resumed).toStrictEqual([]);
	});

	test('sends a worktree recorded building back through the drain though its branch already carries commits', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });
		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(parked.outcomes).toStrictEqual([]);
	});

	test('records what it found for an unrecorded branch, so a second scan needs no git count', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings });

		expect(parked.outcomes).toEqual([expect.objectContaining({ ready: true })]);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Ready }));
	});

	test('records nothing for an unrecorded branch git could not count, so a later scan still asks', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		// `origin/no-such-default` does not exist, so `rev-list --count` refuses.
		const parked = await scanParked({ cwd, defaultBranch: 'no-such-default', settings, trackerSettings, shipSettings });

		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});

	test('hands a tracker failure back, so a restart stops rather than reading every parked tree as withdrawn', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue({ error: 'authentication failed' });

		expect(await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings })).toStrictEqual({
			error: 'authentication failed',
		});
	});
});
