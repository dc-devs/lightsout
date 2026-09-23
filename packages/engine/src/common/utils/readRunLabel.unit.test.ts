import { describe, expect, jest, test } from '@jest/globals';
import { readRunLabel } from '#src/common/utils/readRunLabel.ts';

// Mocked Imports
// -------------------------
// Which ticket the checkout's work order belongs to is the work-order module's
// answer, read out of the record rather than matched against the branch name.
// It is handed here per checkout, so one arrangement covers every rung of the
// ladder without making three git checkouts for it.
interface TicketRefParams {
	cwd: string;
}

const mockReadWorkOrderTicketRef = jest.fn<(params: TicketRefParams) => Promise<string | undefined>>();

jest.mock('#src/workOrder/index.ts', () => ({
	readWorkOrderTicketRef: (params: TicketRefParams) => mockReadWorkOrderTicketRef(params),
}));
// -------------------------
// The branch git names, which is absence outside a worktree and on a detached
// HEAD — the case that reaches the last rung.
interface BranchParams {
	cwd: string;
}

const mockReadGitCurrentBranch = jest.fn<(params: BranchParams) => Promise<string | undefined>>();

jest.mock('#src/common/git/readGitCurrentBranch.ts', () => ({
	readGitCurrentBranch: (params: BranchParams) => mockReadGitCurrentBranch(params),
}));
// -------------------------

const claimed = '/tmp/lightsout-worktrees/lo-2-beta';
const unclaimed = '/tmp/lightsout-worktrees/scratch';
const noBranch = '/tmp/somewhere-that-is-not-a-checkout';

/**
 * Three checkouts, one arrangement: the first is on a branch a work order's
 * record stores, the second on a branch no record claims, and the third on no
 * branch at all. Each rung of the ladder is then one act against one of them.
 */
const setupRunLabel = () => {
	const ticketRefs: Record<string, string | undefined> = { [claimed]: 'LO-2' };
	const branches: Record<string, string | undefined> = {
		[claimed]: 'feature/lo-2-beta',
		[unclaimed]: 'scratch-experiment',
	};

	mockReadWorkOrderTicketRef.mockImplementation(async ({ cwd }) => ticketRefs[cwd]);
	mockReadGitCurrentBranch.mockImplementation(async ({ cwd }) => branches[cwd]);
};

describe('readRunLabel', () => {
	test('climbs the record, then the branch, then `work`', async () => {
		setupRunLabel();

		const recordLabel = await readRunLabel({ cwd: claimed });
		const branchLabel = await readRunLabel({ cwd: unclaimed });
		const fallbackLabel = await readRunLabel({ cwd: noBranch });

		// the record's ticket reference wins, and it is the reference itself rather
		// than any part of the prefixed branch the record stores beside it
		expect(recordLabel).toBe('LO-2');
		// a branch no work order claims is named rather than refused: this only
		// labels a run
		expect(branchLabel).toBe('scratch-experiment');
		// no work order and no branch leaves the tracker-free placeholder, which is
		// `work` and never `ticket` — most repositories have no tracker at all
		expect(fallbackLabel).toBe('work');
		// the record is asked with the checkout alone: nothing on the ladder reads
		// configuration any more, so there is no pattern that could answer
		// differently from the record
		expect(mockReadWorkOrderTicketRef).toHaveBeenCalledWith({ cwd: claimed });
		// the branch is only consulted once the record has answered nothing
		expect(mockReadGitCurrentBranch).not.toHaveBeenCalledWith({ cwd: claimed });
	});
});
