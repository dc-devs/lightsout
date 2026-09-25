import { rm } from 'node:fs/promises';
import { getWorktreeRecordPath } from '#src/worktree/records/internal/common/utils/getWorktreeRecordPath.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * Forget who owned a branch's worktree, tolerating a record that is not there —
 * and a branch no work order claims, which never had one.
 *
 * Best effort and never throws, for the reason `removeWorktree` gives: the tree
 * this described is already gone by the time it runs, and a failed unlink must
 * not turn a shipped branch into a failed one.
 *
 * It is deliberately never called from inside `removeWorktree`. Deleting the
 * record is the caller's step, taken only after a removal that worked, so a
 * tree that survived keeps the record attributing it rather than becoming one
 * nothing claims.
 */
export const deleteWorktreeRecord = async ({ cwd, branch }: Params): Promise<void> => {
	const path = await getWorktreeRecordPath({ cwd, branch });

	if (path === undefined) {
		return;
	}

	// One file removed rather than the folder, because the work order's other
	// records sit beside it and outlive the tree this one described.
	await rm(path, { force: true }).catch(() => undefined);
};
