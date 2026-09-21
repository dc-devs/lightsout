import { join } from 'node:path';
import { ticketsDir } from '#src/common/workspace/ticketsDir.ts';

interface Params {
	/** The directory the command runs in — a primary checkout, a linked worktree, or no repository at all. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
}

/**
 * One ticket's own folder: its record files, its `plans/` folder and its
 * `runs/` folder, all under the primary checkout whichever checkout is asking.
 *
 * It takes a `cwd` rather than an already-resolved state directory, which is
 * what lets a caller that wants the folder and nothing else ask one question
 * instead of two, and it keeps "the record lives once per machine, in the
 * primary checkout" true by construction rather than by every caller
 * remembering.
 */
export const ticketFolderDir = async ({ cwd, ticketBranch }: Params): Promise<string> => join(await ticketsDir({ cwd }), ticketBranch);
