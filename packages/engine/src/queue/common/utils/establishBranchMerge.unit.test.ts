import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase, type BranchState } from '#src/contracts/index.ts';
import { establishBranchMerge } from '#src/queue/common/utils/establishBranchMerge.ts';
import type { PullRequestSummary } from '#src/ship/index.ts';

// Mocked Imports
// -------------------------
// The forge read and the branch-state record each have their own tests. What
// this file owns is the policy: which of the two sources establishes a merge,
// in which order they are asked, and what gets written once one of them has
// answered.
const mockReadBranchState = jest.fn<(params: { cwd: string; branch: string }) => Promise<BranchState | undefined>>();
const mockWriteBranchState = jest.fn<(params: { cwd: string; branch: string; phase: BranchPhase }) => Promise<void>>();
const mockFindPullRequest = jest.fn<(params: { branch: string; cwd: string; state: string }) => Promise<PullRequestSummary | undefined>>();

jest.mock('#src/queue/branchState/index.ts', () => ({
	readBranchState: (params: { cwd: string; branch: string }) => mockReadBranchState(params),
	writeBranchState: (params: { cwd: string; branch: string; phase: BranchPhase }) => mockWriteBranchState(params),
}));
jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	findPullRequest: (params: { branch: string; cwd: string; state: string }) => mockFindPullRequest(params),
}));
// -------------------------

const mergedPullRequest: PullRequestSummary = { number: 41, url: 'https://forge.example/pull/41', title: 'LO-70', branch: 'lo-70-ticket-70' };

/** One branch the queue may already have recorded, and a forge that may or may not report a merged pull request for it. */
const setupEstablish = ({
	recordedPhase,
	forgeAnswer,
}: {
	/** The phase this queue's own record holds for the branch, or nothing recorded at all. */
	recordedPhase?: BranchPhase;
	forgeAnswer?: PullRequestSummary;
} = {}) => {
	mockReadBranchState.mockResolvedValue(
		recordedPhase === undefined ? undefined : { branch: 'lo-70-ticket-70', phase: recordedPhase, updatedAt: '2026-01-01T00:00:00.000Z' },
	);
	mockWriteBranchState.mockResolvedValue(undefined);
	mockFindPullRequest.mockResolvedValue(forgeAnswer);

	const establish = () => establishBranchMerge({ cwd: '/repo', branch: 'lo-70-ticket-70' });

	return { establish };
};

describe('establishBranchMerge', () => {
	test("establishes a merge from the queue's own record, without asking the forge", async () => {
		const { establish } = setupEstablish({ recordedPhase: BranchPhase.Merged });

		const evidence = await establish();

		expect(evidence).toEqual({});
		expect(mockFindPullRequest).not.toHaveBeenCalled();
		expect(mockWriteBranchState).not.toHaveBeenCalled();
	});

	test("establishes a merge from the forge's merged pull request, names it, and records it for later runs", async () => {
		const { establish } = setupEstablish({ forgeAnswer: mergedPullRequest });

		const evidence = await establish();

		expect(mockFindPullRequest).toHaveBeenCalledWith({ branch: 'lo-70-ticket-70', cwd: '/repo', state: 'merged' });
		expect(evidence).toEqual({ pullRequest: mergedPullRequest });
		expect(mockWriteBranchState).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo', branch: 'lo-70-ticket-70', phase: BranchPhase.Merged }));
	});

	test('answers undefined and records nothing when neither source establishes a merge', async () => {
		const { establish } = setupEstablish({ recordedPhase: BranchPhase.Ready });

		const evidence = await establish();

		expect(evidence).toBeUndefined();
		expect(mockFindPullRequest).toHaveBeenCalledWith({ branch: 'lo-70-ticket-70', cwd: '/repo', state: 'merged' });
		expect(mockWriteBranchState).not.toHaveBeenCalled();
	});
});
