import { runStandardsCheck, selectStandardsFindings } from '@/standardsCheck';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import { sourceFiles } from '@/pipeline/common/utils/sourceFiles';

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
