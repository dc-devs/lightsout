import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { BranchState } from '#src/contracts/index.ts';
import { getBranchStatePath } from '#src/queue/branchState/common/utils/getBranchStatePath.ts';

interface Params {
	/** The MAIN repository checkout. */
	cwd: string;
	branch: string;
}

/**
 * What the queue last recorded about a branch, or undefined when nothing was
 * ever recorded, the file is unreadable, or its contents do not satisfy the
 * contract.
 *
 * Undefined means "nobody has recorded this branch", never "the branch is
 * building" — the caller decides what to do with an unrecorded branch, and the
 * parked scan is the one place that decides it by looking at git.
 */
export const readBranchState = async ({ cwd, branch }: Params): Promise<BranchState | undefined> => {
	return readJsonFile({ path: getBranchStatePath({ cwd, branch }), schema: BranchState });
};
