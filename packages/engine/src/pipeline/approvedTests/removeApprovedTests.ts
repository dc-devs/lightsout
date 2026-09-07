import { rm } from 'node:fs/promises';
import { approvedTestsDir } from '#src/pipeline/approvedTests/common/utils/approvedTestsDir.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * Delete the run's approved copies. The manifest records and the review journal
 * stay — they are the evidence; the copies are the working baseline a resume
 * needs and a finished run does not.
 */
export const removeApprovedTests = async ({ run }: Params): Promise<void> => {
	await rm(approvedTestsDir({ cwd: run.cwd, runId: run.current().runId }), { recursive: true, force: true });
};
