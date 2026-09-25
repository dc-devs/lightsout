import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
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
 * Which work order a parked worktree belongs to, and what travels out of that
 * record onto the drain's answer.
 *
 * A sibling of `scanParkedWorktrees.unit.test.ts` rather than more cases in it:
 * that file states which bucket each tree lands in, while both cases here are
 * about the record the tree is matched against — a work order that belongs to
 * no ticket, and a label no part of the branch spells.
 */

// Mocked Imports
// -------------------------
// The tracker read is the one call that would leave the machine. Git is real,
// because the branch each tree holds is read from git and nothing else, and the
// work-order records are real files, because reading them is the subject.
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketLabel = jest.fn<(params: { ticketId: string; label: string | undefined; present: boolean }) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
jest.mock('#src/ticketTracker/setTicketLabel.ts', () => ({
	setTicketLabel: (params: { ticketId: string; label: string | undefined; present: boolean }) => mockSetTicketLabel(params),
}));
// -------------------------
// The forge answers nothing for every branch here, so no tree reads as merged
// and each one reaches the settling the cases are about.
const mockFindPullRequest = jest.fn<(params: { branch: string; cwd: string; state: string }) => Promise<PullRequestSummary | undefined>>();

jest.mock('#src/ship/forge/findPullRequest.ts', () => ({
	findPullRequest: (params: { branch: string; cwd: string; state: string }) => mockFindPullRequest(params),
}));
// -------------------------

const settings = queueSettingsFixture();
const trackerSettings = trackerSettingsFixture();

/** No repository in this file has ever timed out waiting for the machine. */
const holds: GateHolds = {};

/** The tracker's answer for LO-70, carrying the label that keeps a parked ticket delegated to the queue. */
const parkedTicket: TrackerTicket = {
	id: 'id-lo-70',
	identifier: 'LO-70',
	title: 'Sweep the nightly run',
	url: 'https://linear.app/lightsout/issue/LO-70',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: ['planning-not-needed'],
	status: 'In Progress',
	finished: false,
	unfinishedBlockers: [],
};

/**
 * A main checkout holding one work order named from words alone — it has a
 * record and a branch, and belongs to no ticket — with the queue worktree for
 * its branch already cut.
 */
const setupTicketlessWorkOrder = async () => {
	const { cwd } = setupBranchRepo();

	mockFindPullRequest.mockResolvedValue(undefined);
	mockSetTicketLabel.mockResolvedValue(undefined);
	seedWorkOrderRecord({ cwd, name: 'spike-the-idea' });

	const worktreePath = String(
		await createWorktree({ cwd, branch: 'spike-the-idea', startPoint: 'origin/main', owner: WorktreeOwner.Queue, reuseExisting: true }),
	);

	return { cwd, worktreePath };
};

/**
 * A main checkout holding one work order whose three facts are all different
 * from one another: the label `sweep-the-nightly`, the branch
 * `feature/nightly-sweep`, and the ticket LO-70 that neither of them spells.
 *
 * Its worktree is committed and clean, which is the tree the scan sends
 * straight to the merge rather than back through the drain.
 */
const setupPrefixedParkedTree = async () => {
	const { cwd } = setupBranchRepo();

	mockFindPullRequest.mockResolvedValue(undefined);
	mockSetTicketLabel.mockResolvedValue(undefined);
	mockGetTicketsByIdentifiers.mockResolvedValue([parkedTicket]);
	seedWorkOrderRecord({ cwd, name: 'sweep-the-nightly', branch: 'feature/nightly-sweep', ticketRef: 'LO-70' });

	const worktreePath = String(
		await createWorktree({ cwd, branch: 'feature/nightly-sweep', startPoint: 'origin/main', owner: WorktreeOwner.Queue, reuseExisting: true }),
	);

	writeFileSync(join(worktreePath, 'work.ts'), 'export const value = 1;\n');
	execSync('git config user.name t && git config user.email t@t && git add -A && git commit -qm work', { cwd: worktreePath, stdio: 'ignore' });

	return { cwd, worktreePath };
};

describe('scanParkedWorktrees', () => {
	test('leaves a tree alone when its work order belongs to no ticket, naming the work order', async () => {
		const { cwd, worktreePath } = await setupTicketlessWorkOrder();
		const progress: string[] = [];

		const parked = await scanParkedWorktrees({
			cwd,
			defaultBranch: 'main',
			settings,
			trackerSettings,
			holds,
			onProgress: (message) => progress.push(message),
		});

		// The work order exists and stores this branch; what it has no answer for
		// is which ticket the queue would reconcile it against, so the sentence
		// names the work order rather than a pattern the branch failed to match.
		expect(parked).toStrictEqual({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
		expect(progress).toHaveLength(1);
		expect(progress[0]).toEqual(expect.stringContaining(`leaving ${worktreePath} alone`));
		expect(progress[0]).toEqual(expect.stringContaining('its work order spike-the-idea belongs to no ticket'));
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test("carries the work order's label onto the outcome of a tree whose branch spells neither the label nor the ticket", async () => {
		const { cwd, worktreePath } = await setupPrefixedParkedTree();

		const parked = await scanParkedWorktrees({ cwd, defaultBranch: 'main', settings, trackerSettings, holds });

		// Every field comes off the record: the ticket the tracker is asked for,
		// the label the drain carries onward, and the branch it keeps its prefix
		// on. Nothing here could be read back out of any of the others.
		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['LO-70'] }));
		expect(parked).toEqual(
			expect.objectContaining({
				outcomes: [
					expect.objectContaining({
						name: 'sweep-the-nightly',
						branch: 'feature/nightly-sweep',
						worktreePath,
						ready: true,
						ticket: expect.objectContaining({ identifier: 'LO-70' }),
					}),
				],
				resumed: [],
				leftBehind: [],
			}),
		);
	});
});
