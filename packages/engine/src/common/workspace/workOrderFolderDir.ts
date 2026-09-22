import { join } from 'node:path';
import { workOrdersDir } from '#src/common/workspace/workOrdersDir.ts';

interface Params {
	/** The directory the command runs in — a primary checkout, a linked worktree, or no repository at all. */
	cwd: string;
	/** The work order's label, which is also the folder its state and plans sit in. */
	name: string;
}

/**
 * One work order's own folder: its state files, its `plans/` folder and its
 * `runs/` folder, all under the primary checkout whichever checkout is asking.
 *
 * It takes a `cwd` rather than an already-resolved state directory, which is
 * what lets a caller that wants the folder and nothing else ask one question
 * instead of two, and it keeps "the state file lives once per machine, in the
 * primary checkout" true by construction rather than by every caller
 * remembering.
 */
export const workOrderFolderDir = async ({ cwd, name }: Params): Promise<string> => join(await workOrdersDir({ cwd }), name);
