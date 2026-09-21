import { runDirectoryIndex } from '#src/runState/common/constants/runDirectoryIndex.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Turn the run id a user typed into the one on disk. Reports print run ids cut
 * to their first eight characters, so the id a run announces is a prefix rather
 * than a directory name — accepting it here is what lets `resume --run <id>`
 * take the id its own report just showed.
 *
 * The id half of the one lookup `resolveRunDir` takes the directory half of, so
 * the two can never be answered from two different scans.
 *
 * @throws {RunNotFoundError} When no run answers to the id, or when a shortened id matches more than one.
 */
export const resolveRunId = async ({ cwd, runId }: Params): Promise<string> => (await runDirectoryIndex.resolve({ cwd, runId })).runId;
