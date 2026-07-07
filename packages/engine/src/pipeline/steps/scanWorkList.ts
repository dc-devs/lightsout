import { runScan, selectScanFindings } from '../../scan';
import type { PipelineRun } from '../PipelineRun';
import { sourceFiles } from '../common/utils/sourceFiles';

interface Params {
	run: PipelineRun;
}

/**
 * The scan gate's work-list: deterministic findings touching this run's
 * changed files (baseline-suppressed when a ledger exists). Never asks
 * the agent to "go find problems" — detection is code.
 */
export const scanWorkList = async ({ run }: Params): Promise<ReturnType<typeof selectScanFindings>> => {
	const { findings } = await runScan({ cwd: run.cwd, persist: false });

	return selectScanFindings({ findings, changedFiles: sourceFiles({ run }) });
};
