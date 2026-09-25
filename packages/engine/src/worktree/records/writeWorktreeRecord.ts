import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import type { WorktreeRecord } from '#src/contracts/worktree/WorktreeRecord.ts';
import { getWorktreeRecordPath } from '#src/worktree/records/common/utils/getWorktreeRecordPath.ts';

interface Params {
	/** Any checkout of the repository; the record lands in the primary one, so it outlives the tree. */
	cwd: string;
	branch: string;
	owner: WorktreeOwner;
	worktreePath: string;
	/** What the branch was cut from. Omitted for a branch that was adopted rather than cut, so the record never names a commit the tree did not start at. */
	startPoint?: string;
	onProgress?: (message: string) => void;
}

/**
 * Record who a branch's worktree belongs to, atomically (tmp file + rename),
 * from the step that just made it true.
 *
 * A failed write is a progress line and nothing more, exactly as
 * `writeBranchState`'s is, and so is a branch no work order claims: the tree
 * exists either way, and refusing to create it because a JSON write was
 * impossible would be the worse outcome.
 */
export const writeWorktreeRecord = async ({ cwd, branch, owner, worktreePath, startPoint, onProgress }: Params): Promise<void> => {
	const record: WorktreeRecord = { branch, owner, worktreePath, createdAt: new Date().toISOString(), ...(startPoint === undefined ? {} : { startPoint }) };

	try {
		// Resolved inside the try, so a checkout that cannot be resolved is reported
		// as the same progress line a refused write is rather than thrown at the run.
		const recordPath = await getWorktreeRecordPath({ cwd, branch });

		if (recordPath === undefined) {
			onProgress?.(`the worktree for ${branch} was not recorded as '${owner}': no work order's record stores that branch, so it keeps no local record`);

			return;
		}

		await mkdir(dirname(recordPath), { recursive: true });
		await writeJsonFile({ path: `${recordPath}.tmp`, value: record });
		await rename(`${recordPath}.tmp`, recordPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		onProgress?.(`the worktree for ${branch} could not be recorded as '${owner}': ${message}`);
	}
};
