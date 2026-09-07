import { buildFeatureExecutorInvocation } from '#src/agents/index.ts';
import { buildSelfCheckCommand } from '#src/common/selfCheck/buildSelfCheckCommand.ts';
import type { AcceptanceTestRecord } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { formatStep } from '#src/pipeline/steps/formatStep.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/index.ts';
import { workStep } from '#src/pipeline/steps/workStep.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	overviewContent?: string;
	standards?: string;
	fileLimit: number | undefined;
	/** Read at every call rather than captured once, so a re-invocation names the ledger rows as they now stand. */
	acceptanceTests: () => AcceptanceTestRecord[];
}

/** The implement trio: the executor build, the formatter, and the verification that re-invokes the executor when a gate fails. */
export const buildImplementSteps = ({ run, gitPrefix, planContent, overviewContent, standards, fileLimit, acceptanceTests }: Params): PipelineStep[] => {
	// Built once and given to the step's own spawn AND to its fix re-invocation:
	// the two differ only in the user prompt, and a section on one but not the
	// other would split the role's cached system prompt in two.
	const selfCheckCommand = buildSelfCheckCommand({ cwd: run.cwd, runId: run.current().runId }).command;

	return [
		{
			id: 'implement',
			run: workStep({
				run,
				gitPrefix,
				id: 'implement',
				requireChanges: true,
				build: () =>
					buildFeatureExecutorInvocation({
						planContent,
						overviewContent,
						standards,
						allowedCommands: run.config['agent-commands'],
						fileLimit,
						acceptanceTests: acceptanceTests(),
						selfCheckCommand,
					}),
			}),
		},
		formatStep({ run, id: 'format-implement' }),
		{
			id: 'verify-implement',
			run: verifyStep({
				run,
				gitPrefix,
				planContent,
				overviewContent,
				id: 'verify-implement',
				acceptanceTests,
				buildFix: ({ errorContext }) =>
					buildFeatureExecutorInvocation({
						planContent,
						overviewContent,
						standards,
						errorContext,
						changedFiles: run.current().changedFiles,
						allowedCommands: run.config['agent-commands'],
						fileLimit,
						acceptanceTests: acceptanceTests(),
						selfCheckCommand,
					}),
			}),
		},
	];
};
