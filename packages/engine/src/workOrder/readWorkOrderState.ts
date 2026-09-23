import { join } from 'node:path';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import type { WorkOrderState } from '#src/contracts/index.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';
import { readWorkOrderStateFile } from '#src/workOrder/common/utils/readWorkOrderStateFile.ts';

interface Params {
	/** Any checkout of the repository — the primary one, or a linked worktree. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
}

/**
 * One work order's state, read from the primary checkout however many worktrees
 * this machine has.
 *
 * No lock is taken: the store writes by rename, so a reader never meets a
 * half-written file. `{ record: undefined }` says only that no `state.json`
 * exists, which every caller reads as "this is a legacy plan folder" — a
 * corrupt record is an error instead, never undefined.
 */
export const readWorkOrderState = async ({ cwd, name }: Params): Promise<{ record: WorkOrderState | undefined } | { error: string }> => {
	const workOrderFolder = await workOrderFolderDir({ cwd, name });

	return readWorkOrderStateFile({ statePath: join(workOrderFolder, workOrderFileNames.record), name });
};
