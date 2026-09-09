import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/index.ts';
import type { GateHolds } from '#src/gates/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { createTicketWorktree } from '#src/queue/worktrees/createTicketWorktree.ts';
import { scanParkedWorktrees } from '#src/queue/worktrees/scanParkedWorktrees.ts';
import type { PullRequestSummary } from '#src/ship/index.ts';
import type { TrackerFailure, TrackerTicket } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The same doubles the sibling suite uses, plus the forge: the tracker lookup
// and the forge read are the only two things here that would leave the machine.
// Git and the branch-state records are real, because the two new questions this
// file is about are answered from the record first and the forge second.
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketLabel = jest.fn<(params: { ticketId: string; label: string | undefined; present: boolean }) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	setTicketLabel: (params: { ticketId: string; label: string | undefined; present: boolean }) => mockSetTicketLabel(params),
}));
// -------------------------
const mockFindPullRequest = jest.fn<(params: { branch: string; cwd: string; state: string }) => Promise<PullRequestSummary | undefined>>();

jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	findPullRequest: (params: { branch: string; cwd: string; state: string }) => mockFindPullRequest(params),
}));
// -------------------------

const settings = queueSettingsFixture({ parkedLabel: 'queue-parked' });

/** No repository in this file has ever timed out waiting for the machine. */
const holds: GateHolds = {};

const trackerSettings = trackerSettingsFixture();

const shipSettings = shipSettingsFixture();

const mergedPullRequest: PullRequestSummary = { number: 41, url: 'https://forge.example/pull/41', title: 'LO-70', branch: 'lo-70-drain' };

const ticketOf = ({ finished = false }: { finished?: boolean } = {}): TrackerTicket => ({
	id: 'id-lo-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: ['planning-not-needed'],
	status: 'In Progress',
	finished,
	unfinishedBlockers: [],
});

/** Commit something on this worktree's branch, which is what "parked at the ship step" looks like. */
const commitWork = ({ path }: { path: string }) => {
	writeFileSync(join(path, 'work.ts'), 'export const value = 1;\n');
	execSync('git config user.name t && git config user.email t@t && git add -A && git commit -qm work', { cwd: path, stdio: 'ignore' });
};

/**
 * A main checkout with one parked worktree in it, plus everything the two new
 * questions read: what the tracker says about the ticket, what the forge says
 * about the branch, and what this queue already recorded about it.
 */
const setupParkedScan = async ({
	finished = false,
	pullRequest,
	recordedMerged = false,
	committed = false,
	dirty = false,
}: {
	/** What the tracker files the ticket as — the flag the scan reads off the matched runnable ticket. */
	finished?: boolean;
	/** The merged pull request the forge answers with, or undefined for a branch it reports nothing about. */
	pullRequest?: PullRequestSummary;
	/** Whether this queue already recorded the branch merged, so the forge should never be asked. */
	recordedMerged?: boolean;
	committed?: boolean;
	dirty?: boolean;
} = {}) => {
	const branch = 'lo-70-drain';
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const worktreePath = String(await createTicketWorktree({ cwd, branch, defaultBranch: 'main' }));

	mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf({ finished })]);
	mockSetTicketLabel.mockResolvedValue(undefined);
	mockFindPullRequest.mockResolvedValue(pullRequest);

	if (committed) {
		commitWork({ path: worktreePath });
	}

	if (dirty) {
		writeFileSync(join(worktreePath, 'half-done.ts'), 'export const value = 1;\n');
	}

	if (recordedMerged) {
		await writeBranchState({ cwd, branch, phase: BranchPhase.Merged });
	}

	const progress: string[] = [];
	const params = { cwd, defaultBranch: 'main', settings, trackerSettings, shipSettings, holds, onProgress: (message: string) => progress.push(message) };

	return { cwd, branch, worktreePath, progress, params };
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
	test('carries a worktree whose branch the forge reports merged, though this queue recorded nothing about it', async () => {
		const { branch, worktreePath, progress, params } = await setupParkedScan({ pullRequest: mergedPullRequest, committed: true });

		const parked = await scanParked(params);

		expect(parked).toEqual({
			resumed: [],
			outcomes: [],
			leftBehind: [],
			merged: [{ worktreePath, branch, ticket: expect.objectContaining({ identifier: 'LO-70' }) }],
		});
		// The forge is what established this one, so the line names the pull
		// request rather than saying the record answered.
		expect(progress).toEqual([expect.stringContaining('#41')]);
	});

	test('records a merge the forge established, so a later scan needs no forge call', async () => {
		const { cwd, branch, params } = await setupParkedScan({ pullRequest: mergedPullRequest, committed: true });

		const parked = await scanParked(params);

		expect(parked.merged).toHaveLength(1);
		expect(await readBranchState({ cwd, branch })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
	});

	test('asks the forge nothing for a worktree whose branch is already recorded merged', async () => {
		const { branch, worktreePath, params } = await setupParkedScan({ recordedMerged: true, committed: true });

		const parked = await scanParked(params);

		expect(parked.merged).toEqual([{ worktreePath, branch, ticket: expect.objectContaining({ identifier: 'LO-70' }) }]);
		expect(mockFindPullRequest).not.toHaveBeenCalled();
	});

	test("leaves a finished ticket's unmerged worktree in place and says why rather than resuming it", async () => {
		const { worktreePath, progress, params } = await setupParkedScan({ finished: true, committed: true });

		const parked = await scanParked(params);

		expect(parked).toEqual({
			resumed: [],
			outcomes: [],
			leftBehind: [{ identifier: 'lo-70', reason: expect.stringContaining(worktreePath) }],
			merged: [],
		});
		expect(parked.leftBehind[0]?.reason).toMatch(/finished/i);
		expect(parked.leftBehind[0]?.reason).toMatch(/left in place/i);
		expect(existsSync(worktreePath)).toBe(true);
		expect(progress).toEqual([expect.stringContaining('lo-70 ·')]);
	});

	test('reports the finished-but-unmerged skip without the settled flag, because a person still owes that worktree a look', async () => {
		const { params } = await setupParkedScan({ finished: true, committed: true });

		const parked = await scanParked(params);

		expect(parked.leftBehind).toHaveLength(1);
		expect(parked.leftBehind[0]?.settled).toBe(undefined);
	});

	test('skips a finished ticket whose worktree is dirty, rather than sending it back through the drain', async () => {
		const { worktreePath, params } = await setupParkedScan({ finished: true, dirty: true });

		const parked = await scanParked(params);

		expect(parked.resumed).toStrictEqual([]);
		expect(parked.outcomes).toStrictEqual([]);
		expect(parked.leftBehind).toEqual([{ identifier: 'lo-70', reason: expect.stringContaining(worktreePath) }]);
	});

	test('touches the parked label on neither side of a finished-but-unmerged skip', async () => {
		const { params } = await setupParkedScan({ finished: true, committed: true });

		const parked = await scanParked(params);

		expect(parked.leftBehind).toHaveLength(1);
		expect(mockSetTicketLabel).not.toHaveBeenCalled();
	});

	test('classifies an unfinished ticket on an unmerged branch exactly as before, so the new questions change nothing else', async () => {
		const { branch, worktreePath, params } = await setupParkedScan({ committed: true });

		const parked = await scanParked(params);

		expect(parked).toEqual({
			resumed: [],
			outcomes: [expect.objectContaining({ branch, worktreePath, ready: true })],
			leftBehind: [],
			merged: [],
		});
	});
});
