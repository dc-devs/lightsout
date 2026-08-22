import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { runStandardsCheck, selectStandardsFindings } from '#src/standardsCheck/index.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The standards gate's work-list: deterministic findings touching this run's
 * changed files (baseline-suppressed when a ledger exists). Never asks
 * the agent to "go find problems" — detection is code.
 *
 * Scoped with `standardsScopeFiles` rather than `sourceFiles`, because a
 * finding may be ABOUT a test file even though a test file never earns an
 * agent turn of its own. Scoping this with the agent-attention list silently
 * discarded every such finding, so the run reported zero blocking while they
 * stood in the tree.
 */
export const standardsWorkList = async ({ run }: Params): Promise<ReturnType<typeof selectStandardsFindings>> => {
	const { findings } = await runStandardsCheck({ cwd: run.cwd, persist: false });

	return selectStandardsFindings({ findings, changedFiles: standardsScopeFiles({ run }) });
};
