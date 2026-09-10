import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import type { WorktreeOwner, WorktreeRecord } from '#src/contracts/index.ts';
import { getWorktreeRecordPath } from '#src/worktree/records/common/utils/getWorktreeRecordPath.ts';

interface Params {
	/** Any checkout of the repository; the record lands in the primary one, so it outlives the tree. */
	cwd: string;
	branch: string;
	owner: WorktreeOwner;
	worktreePath: string;
	onProgress?: (message: string) => void;
}

/**
 * Record who a branch's worktree belongs to, atomically (tmp file + rename),
 * from the step that just made it true.
 *
 * A failed write is a progress line and nothing more, exactly as
 * `writeBranchState`'s is: the tree exists either way, and refusing to create
 * it because a JSON write failed would be the worse outcome.
 */
export const writeWorktreeRecord = async ({ cwd, branch, owner, worktreePath, onProgress }: Params): Promise<void> => {
	const record: WorktreeRecord = { branch, owner, worktreePath, createdAt: new Date().toISOString() };
	const stateDir = await resolveSharedStateDir({ cwd });
	const recordPath = getWorktreeRecordPath({ stateDir, branch });

	try {
		await mkdir(dirname(recordPath), { recursive: true });
		await writeJsonFile({ path: `${recordPath}.tmp`, value: record });
		await rename(`${recordPath}.tmp`, recordPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		onProgress?.(`the worktree for ${branch} could not be recorded as '${owner}': ${message}`);
	}
};
