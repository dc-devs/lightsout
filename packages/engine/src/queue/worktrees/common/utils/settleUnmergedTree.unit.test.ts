import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import type { BranchState } from '#src/contracts/queue/BranchState.ts';
import type { ParkedTree } from '#src/queue/worktrees/common/types/ParkedTree.ts';
import { settleUnmergedTree } from '#src/queue/worktrees/common/utils/settleUnmergedTree.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The git status read, the branch-state record and the tracker write each have
// their own tests. What this file owns is the outcome one settled tree answers.
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({ readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params) }));
// -------------------------
const mockReadBranchState = jest.fn<(params: { cwd: string; branch: string }) => Promise<BranchState | undefined>>();

jest.mock('#src/queue/branchState/readBranchState.ts', () => ({
	readBranchState: (params: { cwd: string; branch: string }) => mockReadBranchState(params),
}));
// -------------------------
const mockSetTicketLabel =
	jest.fn<(params: { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean }) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/setTicketLabel.ts', () => ({
	setTicketLabel: (params: { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean }) => mockSetTicketLabel(params),
}));
// -------------------------

/**
 * One parked worktree of a work order whose label and branch differ, with its
 * tree committed and clean and its branch recorded ready to merge.
 */
const setupSettle = () => {
	mockReadGitChangedFiles.mockResolvedValue([]);
	mockReadBranchState.mockResolvedValue({ branch: 'feature/lo-70-parked-tree', phase: BranchPhase.Ready, updatedAt: '2026-01-01T00:00:00.000Z' });
	mockSetTicketLabel.mockResolvedValue(undefined);

	const tree: ParkedTree = {
		path: '/repo-worktrees/lo-70-parked-tree',
		branch: 'feature/lo-70-parked-tree',
		identifier: 'LO-70',
		name: 'lo-70-parked-tree',
	};

	return {
		cwd: '/repo',
		tree,
		ticket: queueTicketFixture({ number: 70 }),
		defaultBranch: 'main',
		settings: queueSettingsFixture({ parkedLabel: 'parked' }),
		trackerSettings: trackerSettingsFixture(),
	};
};

describe('settleUnmergedTree', () => {
	test("carries the work order's label onto the settled outcome", async () => {
		const { cwd, tree, ticket, defaultBranch, settings, trackerSettings } = setupSettle();

		const outcome = await settleUnmergedTree({ cwd, tree, ticket, defaultBranch, settings, trackerSettings });

		// The label travels beside the branch rather than being read back out of
		// it: this branch carries a prefix the label does not, so a consumer that
		// re-derived one from the other would answer `feature/lo-70-parked-tree`.
		expect(outcome).toEqual(
			expect.objectContaining({ name: 'lo-70-parked-tree', branch: 'feature/lo-70-parked-tree', worktreePath: '/repo-worktrees/lo-70-parked-tree' }),
		);
	});
});
