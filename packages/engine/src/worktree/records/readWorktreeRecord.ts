import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { WorktreeRecord } from '#src/contracts/index.ts';
import { getWorktreeRecordPath } from '#src/worktree/records/common/utils/getWorktreeRecordPath.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * Who made the branch's worktree, or undefined when nothing was ever recorded,
 * the file is unreadable, or its contents do not satisfy the contract.
 *
 * Undefined means "nobody claims this tree", never "the tree is free": a tree a
 * drain made before ownership was recorded reads exactly like one nobody made,
 * and the caller decides what an unclaimed tree is worth.
 */
export const readWorktreeRecord = async ({ cwd, branch }: Params): Promise<WorktreeRecord | undefined> => {
	const stateDir = await resolveSharedStateDir({ cwd });

	return readJsonFile({ path: getWorktreeRecordPath({ stateDir, branch }), schema: WorktreeRecord });
};
