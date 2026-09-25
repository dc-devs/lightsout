import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';
import { readBranchState } from '#src/queue/branchState/readBranchState.ts';
import { writeBranchState } from '#src/queue/branchState/writeBranchState.ts';
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
 * What the scan reads out of a branch's phase record, and what it writes back.
 *
 * A sibling of `scanParkedWorktrees.unit.test.ts` rather than more cases in it:
 * that file states which bucket each tree lands in from git alone, while every
 * case here is about the recorded phase beside the tree — the fact a second
 * scan reads instead of counting commits again.
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

describe('scanParkedWorktrees', () => {
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

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		// A git count would answer zero here and drain it; the record is what decides.
		expect(parked.outcomes).toEqual([expect.objectContaining({ worktreePath: paths['lo-70-drain'], ready: true })]);
		expect(parked.resumed).toStrictEqual([]);
	});

	test('sends a worktree recorded building back through the drain though its branch already carries commits', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });
		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(parked.outcomes).toStrictEqual([]);
	});

	test('records what it found for an unrecorded branch, so a second scan needs no git count', async () => {
		const { cwd, paths } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);
		commitWork({ path: paths['lo-70-drain'] });

		const parked = await scanParked({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		expect(parked.outcomes).toEqual([expect.objectContaining({ ready: true })]);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Ready }));
	});

	test('records nothing for an unrecorded branch git could not count, so a later scan still asks', async () => {
		const { cwd } = await setupParkedRepo({ branches: ['lo-70-drain'] });

		mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf('lo-70')]);

		// `origin/no-such-default` does not exist, so `rev-list --count` refuses.
		const parked = await scanParked({ cwd, defaultBranch: 'no-such-default', settings, trackerSettings, holds });

		expect(parked.resumed).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});
});
