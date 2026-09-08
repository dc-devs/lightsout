import { describe, expect, jest, test } from '@jest/globals';
import type { BranchPhase } from '#src/contracts/index.ts';
import type { ParkedTree } from '#src/queue/worktrees/common/types/ParkedTree.ts';
import { classifyUnrecordedTree } from '#src/queue/worktrees/common/utils/classifyUnrecordedTree.ts';

// Mocked Imports
// -------------------------
// The git count and the record write each have their own tests. What this file
// owns is the policy between them: which bucket a count sends a tree to, and
// that a count git never gave is never written down.
const mockReadGitCommitsAhead = jest.fn<(params: { cwd: string; defaultBranch: string }) => Promise<number | undefined>>();
const mockWriteBranchState = jest.fn<(params: { cwd: string; branch: string; phase: BranchPhase }) => Promise<void>>();

jest.mock('#src/common/git/readGitCommitsAhead.ts', () => ({
	readGitCommitsAhead: (params: { cwd: string; defaultBranch: string }) => mockReadGitCommitsAhead(params),
}));
jest.mock('#src/queue/branchState/index.ts', () => ({
	writeBranchState: (params: { cwd: string; branch: string; phase: BranchPhase }) => mockWriteBranchState(params),
}));
// -------------------------

const tree: ParkedTree = { path: '/repo-worktrees/lo-78-drain', branch: 'lo-78-drain', identifier: 'LO-78' };

/** What `git rev-list --count` answered: commits ahead, none ahead, or no answer at all. */
const countFor = { ahead: 3, none: 0, unreadable: undefined };

const setupClassify = ({ count = 'ahead' }: { count?: keyof typeof countFor } = {}) => {
	mockReadGitCommitsAhead.mockResolvedValue(countFor[count]);
	mockWriteBranchState.mockResolvedValue(undefined);

	const classify = () => classifyUnrecordedTree({ cwd: '/repo', tree, defaultBranch: 'main' });

	return { classify };
};

describe('classifyUnrecordedTree', () => {
	test('records what git counted for an unrecorded branch, and records nothing when git gave no count', async () => {
		// Each count is set immediately before the call it answers: one shared
		// double stands in for git, so setting all three up front would leave
		// every call reading the last one.
		const ahead = await setupClassify({ count: 'ahead' }).classify();
		const none = await setupClassify({ count: 'none' }).classify();
		const unreadable = await setupClassify({ count: 'unreadable' }).classify();

		expect([ahead, none, unreadable]).toStrictEqual(['ship', 'drain', 'drain']);
		expect(mockWriteBranchState.mock.calls.map(([params]) => params)).toEqual([
			expect.objectContaining({ cwd: '/repo', branch: 'lo-78-drain', phase: 'ready' }),
			expect.objectContaining({ cwd: '/repo', branch: 'lo-78-drain', phase: 'building' }),
		]);
	});
});
