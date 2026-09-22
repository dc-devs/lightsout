import { join } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';

interface Params {
	/** The directory the command runs in — a primary checkout, a linked worktree, or no repository at all. */
	cwd: string;
}

/**
 * The folder every ticket folder lives in — one gitignored directory under the
 * primary checkout's root, holding one folder per ticket branch.
 *
 * `workOrderFolderDir` answers for one ticket inside it; this answers for the
 * folder itself, which is what listing every plan a repo has needs. The primary
 * checkout is resolved here rather than passed in because forty call sites can
 * each pass the wrong checkout, where one helper can be passed no checkout at
 * all: every checkout of one repository must see one set of tickets, and a
 * worktree that gets removed must take none of them with it.
 *
 * The directory is never created here: whoever writes into it creates it, as
 * `resolveSharedStateDir` states.
 */
export const ticketsDir = async ({ cwd }: Params): Promise<string> => join(await resolveSharedStateDir({ cwd }), 'tickets');
