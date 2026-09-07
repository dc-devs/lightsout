import { readFile } from 'node:fs/promises';
import { readGitCommittedFile } from '#src/common/git/readGitCommittedFile.ts';
import { approvedTestPath } from '#src/pipeline/approvedTests/approvedTestPath.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	/** Repo-relative path of a test-side file. */
	path: string;
}

/**
 * The approved version of one test-side file: the run's own copy when the
 * manifest records one, nothing when it records an approved removal, the file's
 * content at `HEAD` otherwise.
 *
 * A run starts from a clean tree, so `HEAD` is the approved repository test
 * until the run approves something newer.
 *
 * @returns the approved content, or undefined when the approved state of this
 * path is "no file" — an approved removal and a path that never existed are the
 * same answer, because in both the live file being present is an addition.
 */
export const readApprovedTest = async ({ run, path }: Params): Promise<string | undefined> => {
	const { runId, approvedTests } = run.current();
	const record = approvedTests.find((entry) => entry.path === path);

	if (record?.removed === true) {
		return undefined;
	}

	if (record?.sha256 !== undefined) {
		return readFile(approvedTestPath({ cwd: run.cwd, runId, path }), 'utf8').catch(() => undefined);
	}

	return readGitCommittedFile({ cwd: run.cwd, path });
};
