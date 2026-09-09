import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * Repo-relative path → sha256 of the file's current bytes, for every
 * standards-scope changed file that exists on disk.
 *
 * Taken before cleanup and again after every round, this is how the step knows
 * what cleanup itself changed: a report may omit a file it edited, and a
 * timed-out attempt leaves edits behind with no report at all, so bytes are the
 * only account that cannot be wrong.
 *
 * A path whose file cannot be read is omitted rather than recorded, so a file
 * the round deleted simply reads as absent on the later side instead of raising
 * an error the step would have to decide what to do with.
 */
export const fingerprintScopeFiles = async ({ run }: Params): Promise<Record<string, string>> => {
	const entries = await Promise.all(
		standardsScopeFiles({ run }).map(async (file) => {
			const content = await readFile(join(run.cwd, file)).catch(() => undefined);

			return content === undefined ? [] : [[file, sha256({ content })] as const];
		}),
	);

	return Object.fromEntries(entries.flat());
};
