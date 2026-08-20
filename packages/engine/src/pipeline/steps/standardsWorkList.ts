import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { runStandardsCheck, selectStandardsFindings } from '#src/standardsCheck/index.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The standards gate's work-list: deterministic findings touching this run's
 * changed files (baseline-suppressed when a ledger exists). Never asks
 * the agent to "go find problems" — detection is code.
 */
export const standardsWorkList = async ({ run }: Params): Promise<ReturnType<typeof selectStandardsFindings>> => {
	const { findings } = await runStandardsCheck({ cwd: run.cwd, persist: false });

	return selectStandardsFindings({ findings, changedFiles: sourceFiles({ run }) });
};
