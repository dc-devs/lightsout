import type { CoverageBatchReport, LightsoutConfig } from '#src/contracts/index.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import { runCoverageCheck } from '#src/coverage/runCoverageCheck.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	runId: string;
	batch: CoverageBatch;
}

/**
 * Re-measure the batch's scope and compare every tracked file against its
 * pre-batch percentage. Any file whose statements percentage strictly improved
 * is what resolves a batch, so the comparison is the batch's whole verdict.
 */
export const measureCoverageBatch = async ({ cwd, config, runId, batch }: Params): Promise<{ files: CoverageBatchReport['files']; improved: boolean }> => {
	const measured = await runCoverageCheck({ cwd, config, scope: batch.scope, runId, step: batch.id });
	const pctByPath = new Map(measured.files.map((file) => [file.path, file.statementsPct]));
	// A file absent from the fresh summary counts as unimproved: the writer
	// covered nothing the measurement can see.
	const files = batch.files.map((file) => ({ path: file.path, beforePct: file.statementsPct, afterPct: pctByPath.get(file.path) ?? file.statementsPct }));

	return { files, improved: files.some((file) => file.afterPct > file.beforePct) };
};
