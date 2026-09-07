import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { ApprovedTestRecord } from '#src/contracts/index.ts';
import { approvedTestPath } from '#src/pipeline/approvedTests/approvedTestPath.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	/** Repo-relative paths whose current state becomes approved. */
	paths: string[];
}

/**
 * Record the approved version of the given test-side paths: a copy in the run
 * folder plus its hash for a path that exists, an approved removal for one that
 * does not.
 *
 * Called after the formatter wherever it runs, so the copy is of formatted
 * bytes and the next checkpoint's diff against this baseline is the agent's
 * edit rather than the formatter's.
 *
 * @returns the manifest's next `approvedTests` — the existing entries with these paths replaced.
 */
export const approveTestFiles = async ({ run, paths }: Params): Promise<ApprovedTestRecord[]> => {
	const { runId, approvedTests } = run.current();
	const records: ApprovedTestRecord[] = [];

	for (const path of paths) {
		const content = await readFile(join(run.cwd, path)).catch(() => undefined);
		const copy = approvedTestPath({ cwd: run.cwd, runId, path });

		if (content === undefined) {
			// A stale copy left behind would make the next checkpoint bundle the
			// same deletion all over again.
			await rm(copy, { force: true });
			records.push({ path, removed: true });

			continue;
		}

		await mkdir(dirname(copy), { recursive: true });
		await writeFile(copy, content);
		records.push({ path, sha256: sha256({ content }), removed: false });
	}

	// One path, one record: two records for the same path would leave the
	// baseline asking which of them the live file has to match.
	return [...approvedTests.filter((record) => !paths.includes(record.path)), ...records];
};
