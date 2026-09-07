import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { buildSelfCheckCommand } from '#src/common/selfCheck/buildSelfCheckCommand.ts';
import type { AcceptanceTestRecord } from '#src/contracts/index.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { formatStep } from '#src/pipeline/steps/formatStep.ts';
import { refactorStep } from '#src/pipeline/steps/refactorStep.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/index.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	overviewContent?: string;
	standards?: string;
	skipRefactor?: boolean;
	/** Read at every call rather than captured once, so a re-invocation names the ledger rows as they now stand. */
	acceptanceTests: () => AcceptanceTestRecord[];
}

/**
 * The refactor steps: the standards-gated loop, formatter, and verification,
 * or nothing when the caller asked to skip them.
 *
 * The code-writing entries scope on `standardsScopeFiles` rather than
 * `sourceFiles`: the gate judges findings on the test files a run wrote, so a
 * run whose only changed files are tests still has standards to answer for.
 */
export const buildRefactorSteps = ({ run, gitPrefix, planContent, overviewContent, standards, skipRefactor, acceptanceTests }: Params): PipelineStep[] =>
	skipRefactor
		? []
		: [
				{
					id: 'refactor',
					skip: () => (standardsScopeFiles({ run }).length === 0 ? 'no changed source files to review' : undefined),
					run: refactorStep({ run, gitPrefix, planContent, overviewContent, standards }),
				},
				formatStep({ run, id: 'format-refactor' }),
				{
					id: 'verify-refactor',
					run: verifyStep({
						run,
						gitPrefix,
						planContent,
						overviewContent,
						id: 'verify-refactor',
						coverage: true,
						acceptanceTests,
						// Where the refactor steps run at all, this is the run's last
						// verification — and the last one is where every acceptance test
						// must be proven against the finished tree.
						final: true,
						buildFix: ({ errorContext }) =>
							buildRefactorExecutorInvocation({
								scope: RefactorScope.Feature,
								planContent,
								overviewContent,
								changedFiles: standardsScopeFiles({ run }),
								standards,
								errorContext,
								selfCheckCommand: buildSelfCheckCommand({ cwd: run.cwd, runId: run.current().runId }).command,
							}),
					}),
				},
			];
