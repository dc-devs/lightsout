import { runDirectoryIndex } from '#src/runState/internal/common/constants/runDirectoryIndex.ts';

interface Params {
	cwd: string;
	/** Full run id, or the shortened eight-character form a report printed. */
	runId: string;
}

/**
 * Where an EXISTING run lives — searched once per process and remembered.
 *
 * A run of a plan sits in that plan's ticket folder and a run belonging to no
 * plan under the command that owns it, so no path can be joined onto a run id
 * to find one. `resolveNewRunDir` answers for a run that does not exist yet:
 * a lookup has to search, and a creation must not.
 *
 * It creates nothing. A helper naming a directory never makes it, as
 * `resolveSharedStateDir` states; whoever writes into a run folder creates it,
 * and `createRun` is the one place that does.
 *
 * @throws {RunNotFoundError} When no run answers to the id, or when a shortened id matches more than one.
 */
export const resolveRunDir = async ({ cwd, runId }: Params): Promise<string> => (await runDirectoryIndex.resolve({ cwd, runId })).runDir;
