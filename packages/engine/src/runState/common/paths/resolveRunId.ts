import { readdir } from 'node:fs/promises';
import { getRunsDir } from '#src/runState/common/paths/getRunsDir.ts';
import { RunNotFoundError } from '#src/runState/RunNotFoundError.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Turn the run id a user typed into the one on disk. Reports print run ids cut
 * to their first eight characters, so the id a run announces is a prefix rather
 * than a directory name — accepting it here is what lets `resume --run <id>`
 * take the id its own report just showed.
 */
export const resolveRunId = async ({ cwd, runId }: Params): Promise<string> => {
	const entries = await readdir(getRunsDir({ cwd }), { withFileTypes: true }).catch(() => []);
	// Only a directory holds a manifest, so stray files are never candidates.
	const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

	// An exact directory is an answer in its own right, never a prefix of a longer one.
	if (runIds.includes(runId)) {
		return runId;
	}

	const matches = runIds.filter((candidate) => candidate.startsWith(runId));

	if (matches.length === 1) {
		return matches[0];
	}

	if (matches.length === 0) {
		throw new RunNotFoundError(`no run matching '${runId}' — list the runs this repo has with: lightsout status`);
	}

	throw new RunNotFoundError(`run id '${runId}' matches ${matches.length} runs (${matches.join(', ')}) — pass more of the id`);
};
