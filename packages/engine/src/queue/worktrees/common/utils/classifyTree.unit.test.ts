import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase, type BranchState } from '#src/contracts/index.ts';
import type { ParkedTree } from '#src/queue/worktrees/common/types/ParkedTree.ts';
import { classifyTree } from '#src/queue/worktrees/common/utils/classifyTree.ts';

// Mocked Imports
// -------------------------
// The git status read and the branch-state record each have their own tests.
// What this file owns is the policy: which answer one parked worktree gets, and
// in which order the two sources are asked.
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();
const mockReadBranchState = jest.fn<(params: { cwd: string; branch: string }) => Promise<BranchState | undefined>>();
const mockWriteBranchState = jest.fn<(params: { cwd: string; branch: string; phase: BranchPhase }) => Promise<void>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({ readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params) }));
jest.mock('#src/queue/branchState/index.ts', () => ({
	readBranchState: (params: { cwd: string; branch: string }) => mockReadBranchState(params),
	writeBranchState: (params: { cwd: string; branch: string; phase: BranchPhase }) => mockWriteBranchState(params),
}));
// -------------------------

/** One worktree of the queue's own, named after the branch it holds. */
const treeOf = ({ branch }: { branch: string }): ParkedTree => ({ path: `/repo-worktrees/${branch}`, branch, identifier: 'LO-70' });

/**
 * What the queue recorded about each branch, keyed by branch, and what `git
 * status` finds in each worktree, keyed by worktree path. A worktree the
 * `changed` map does not name is clean.
 */
const setupClassify = ({
	recorded = {},
	changed = {},
}: {
	recorded?: Record<string, BranchPhase | undefined>;
	changed?: Record<string, string[] | undefined>;
} = {}) => {
	mockReadBranchState.mockImplementation(({ branch }) => {
		const phase = recorded[branch];

		return Promise.resolve(phase === undefined ? undefined : { branch, phase, updatedAt: '2026-01-01T00:00:00.000Z' });
	});
	mockReadGitChangedFiles.mockImplementation(({ cwd }) => Promise.resolve(Object.hasOwn(changed, cwd) ? changed[cwd] : []));

	return { cwd: '/repo', defaultBranch: 'main' };
};

describe('classifyTree', () => {
	test('sends a branch recorded ready to the merge and one recorded building back to the drain, with no merged answer left to give', async () => {
		const { cwd, defaultBranch } = setupClassify({
			recorded: { 'lo-70-ready': BranchPhase.Ready, 'lo-71-building': BranchPhase.Building, 'lo-72-merged': BranchPhase.Merged },
		});

		const ready = await classifyTree({ cwd, tree: treeOf({ branch: 'lo-70-ready' }), defaultBranch });
		const building = await classifyTree({ cwd, tree: treeOf({ branch: 'lo-71-building' }), defaultBranch });
		const merged = await classifyTree({ cwd, tree: treeOf({ branch: 'lo-72-merged' }), defaultBranch });

		// The merged record is now just "not ready": the merge question is asked
		// before this helper runs, so `settled` is no longer an answer it can give.
		expect({ ready, building, merged }).toStrictEqual({ ready: 'ship', building: 'drain', merged: 'drain' });
		// The record is read from the main checkout, never from the worktree.
		expect(mockReadBranchState).toHaveBeenCalledWith({ cwd: '/repo', branch: 'lo-70-ready' });
	});

	test('drains a dirty worktree and reports one git cannot read at all', async () => {
		const { cwd, defaultBranch } = setupClassify({
			recorded: { 'lo-70-dirty': BranchPhase.Ready, 'lo-71-unreadable': BranchPhase.Ready },
			changed: { '/repo-worktrees/lo-70-dirty': ['src/a.ts'], '/repo-worktrees/lo-71-unreadable': undefined },
		});

		const dirty = await classifyTree({ cwd, tree: treeOf({ branch: 'lo-70-dirty' }), defaultBranch });
		const unreadable = await classifyTree({ cwd, tree: treeOf({ branch: 'lo-71-unreadable' }), defaultBranch });

		// Both branches are recorded ready, so a `ship` here would mean the record
		// had been read before git was: uncommitted work must never reach the merge.
		expect({ dirty, unreadable }).toStrictEqual({ dirty: 'drain', unreadable: 'unreadable' });
	});
});
