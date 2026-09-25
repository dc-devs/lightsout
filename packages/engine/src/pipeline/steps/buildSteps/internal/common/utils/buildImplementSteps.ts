import { buildFeatureExecutorInvocation } from '#src/agents/buildFeatureExecutorInvocation.ts';
import type { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';
import type { AcceptanceTestRecord } from '#src/contracts/run/AcceptanceTestRecord.ts';
import type { PipelineRun } from '#src/pipeline/internal/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/internal/PipelineStep.ts';
import type { FixBuilder } from '#src/pipeline/internal/steps/common/types/FixBuilder.ts';
import { formatStep } from '#src/pipeline/internal/steps/formatStep.ts';
import { workStep } from '#src/pipeline/internal/steps/workStep.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/verifyStep.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	overviewContent?: string;
	standards?: string;
	fileLimit: number | undefined;
	/** Read at every call rather than captured once, so a re-invocation names the ledger rows as they now stand. */
	acceptanceTests: () => AcceptanceTestRecord[];
	/** The plan's declared renames; empty for every plan that is not rename-only. */
	renames: RenameRule[];
	/** The same command the fix re-invocation carries, so the role's cached system prompt stays one. */
	selfCheckCommand: string;
	/** The feature executor's fix re-invocation, shared with a rename-only plan's verify-tests. */
	buildFix: FixBuilder;
}

/** The implement trio: the executor build, the formatter, and the verification that re-invokes the executor when a gate fails. */
export const buildImplementSteps = ({
	run,
	gitPrefix,
	planContent,
	overviewContent,
	standards,
	fileLimit,
	acceptanceTests,
	renames,
	selfCheckCommand,
	buildFix,
}: Params): PipelineStep[] => [
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
					renames,
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
			renames,
			buildFix,
		}),
	},
];
