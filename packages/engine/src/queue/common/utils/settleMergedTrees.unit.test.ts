import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { MergedParkedTree } from '#src/queue/common/types/MergedParkedTree.ts';
import { settleMergedTrees } from '#src/queue/common/utils/settleMergedTrees.ts';
import type { TrackerFailure } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker write, the git status read and the worktree removal each have
// their own tests. What this file owns is the policy: that every tree yields one
// settled entry, and that no failure along the way drops it.
const mockReconcileShippedTicket = jest.fn<(params: { ticketRef: string | undefined }) => Promise<string | undefined>>();
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();
const mockRemoveTicketWorktree = jest.fn<(params: { cwd: string; worktreePath: string; branch: string }) => Promise<void>>();
const mockSetParkedLabel = jest.fn<(params: { ticketId: string; parked: boolean }) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	reconcileShippedTicket: (params: { ticketRef: string | undefined }) => mockReconcileShippedTicket(params),
}));
jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({ readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params) }));
jest.mock('#src/queue/removeTicketWorktree.ts', () => ({
	removeTicketWorktree: (params: { cwd: string; worktreePath: string; branch: string }) => mockRemoveTicketWorktree(params),
}));
jest.mock('#src/ticketTracker/index.ts', () => ({ setParkedLabel: (params: { ticketId: string; parked: boolean }) => mockSetParkedLabel(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const treeOf = ({ number }: { number: number }): MergedParkedTree => ({
	worktreePath: `/repo-worktrees/lo-${number}-drain`,
	branch: `lo-${number}-drain`,
	ticket: {
		id: `id-${number}`,
		identifier: `LO-${number}`,
		title: `Ticket ${number}`,
		description: '',
		priority: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		labels: [],
		status: 'In Progress',
		unfinishedBlockers: [],
		planningStatus: PlanningStatus.NotNeeded,
		worker: QueueWorker.Direct,
	},
});

/** What `git status` finds in each worktree: nothing to commit, or something to commit. */
const changedFilesFor = { clean: [] as string[], dirty: ['src/a.ts'] };

const setupSettle = ({
	worktree = 'clean',
	reconciliationFailure,
	labelFailure,
}: {
	worktree?: keyof typeof changedFilesFor;
	reconciliationFailure?: string;
	labelFailure?: TrackerFailure;
} = {}) => {
	const progress: string[] = [];

	mockReconcileShippedTicket.mockResolvedValue(reconciliationFailure);
	mockReadGitChangedFiles.mockResolvedValue(changedFilesFor[worktree]);
	mockRemoveTicketWorktree.mockResolvedValue(undefined);
	mockSetParkedLabel.mockResolvedValue(labelFailure);

	const settle = ({ numbers }: { numbers: number[] }) =>
		settleMergedTrees({
			cwd: '/repo',
			config,
			env: {},
			settings: queueSettingsFixture(),
			trackerSettings: trackerSettingsFixture(),
			merged: numbers.map((number) => treeOf({ number })),
			onProgress: (message) => progress.push(message),
		});

	return { settle, progress };
};

describe('settleMergedTrees', () => {
	test('answers nothing and touches nothing when the scan found no merged tree', async () => {
		const { settle } = setupSettle();

		expect(await settle({ numbers: [] })).toStrictEqual([]);
		expect(mockReconcileShippedTicket).not.toHaveBeenCalled();
		expect(mockRemoveTicketWorktree).not.toHaveBeenCalled();
	});

	test('reconciles each tree to done and reports one settled entry apiece, so nothing waits on a re-run', async () => {
		const { settle } = setupSettle();

		const settled = await settle({ numbers: [70, 71] });

		expect(mockReconcileShippedTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'LO-70' }));
		expect(settled).toStrictEqual([
			{
				identifier: 'LO-70',
				reason: 'its worktree at /repo-worktrees/lo-70-drain held a branch already recorded merged, so the ticket was reconciled to done rather than resumed',
				settled: true,
			},
			{
				identifier: 'LO-71',
				reason: 'its worktree at /repo-worktrees/lo-71-drain held a branch already recorded merged, so the ticket was reconciled to done rather than resumed',
				settled: true,
			},
		]);
	});

	test('removes the clean worktree and clears the parked label, because the ticket is finished rather than waiting on a human', async () => {
		const { settle } = setupSettle();

		await settle({ numbers: [70] });

		expect(mockRemoveTicketWorktree).toHaveBeenCalledWith({ cwd: '/repo', worktreePath: '/repo-worktrees/lo-70-drain', branch: 'lo-70-drain' });
		expect(mockSetParkedLabel).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'id-70', parked: false }));
	});

	test('keeps a worktree with uncommitted changes and says so in the reason', async () => {
		const { settle } = setupSettle({ worktree: 'dirty' });

		const settled = await settle({ numbers: [70] });

		expect(mockRemoveTicketWorktree).not.toHaveBeenCalled();
		expect(settled[0]?.reason).toContain('left in place because it has uncommitted changes');
	});

	test('appends a failed reconciliation to the reason rather than dropping the entry, since a tracker cannot undo a merge', async () => {
		const { settle, progress } = setupSettle({ reconciliationFailure: "LO-70 shipped, but no 'Done' transition" });

		const settled = await settle({ numbers: [70] });

		expect(settled[0]?.reason).toContain("LO-70 shipped, but no 'Done' transition");
		expect(settled[0]?.settled).toBe(true);
		expect(progress).toContain("LO-70 shipped, but no 'Done' transition");
	});

	test('reports a parked label it could not clear and settles the tree anyway', async () => {
		const { settle, progress } = setupSettle({ labelFailure: { error: 'the tracker refused the label write' } });

		const settled = await settle({ numbers: [70] });

		expect(progress).toContain('LO-70 · the parked label could not be cleared: the tracker refused the label write');
		expect(settled[0]?.settled).toBe(true);
	});
});
