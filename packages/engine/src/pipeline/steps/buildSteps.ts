import { buildFeatureExecutorInvocation, buildRefactorExecutorInvocation, buildUnitTestWriterInvocation } from '@/agents';
import { sourceFiles } from '@/pipeline/common/utils/sourceFiles';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import type { PipelineStep } from '@/pipeline/PipelineStep';
import { cleanSlateStep } from '@/pipeline/steps/cleanSlateStep';
import { formatStep } from '@/pipeline/steps/formatStep';
import { refactorStep } from '@/pipeline/steps/refactorStep';
import { verifyStep } from '@/pipeline/steps/verifyStep';
import { workStep } from '@/pipeline/steps/workStep';
import { writeTestsStep } from '@/pipeline/steps/writeTestsStep';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	overviewContent?: string;
	standards?: string;
	testStandards?: string;
	skipRefactor?: boolean;
}

/**
 * The pipeline's step sequence, assembled: clean-slate → implement → verify →
 * write-tests → verify → refactor loop → verify → format, with the refactor
 * pair dropped when skipRefactor asks for it.
 */
export const buildSteps = ({ run, gitPrefix, planContent, overviewContent, standards, testStandards, skipRefactor }: Params): PipelineStep[] => {
	const refactorSteps: PipelineStep[] = skipRefactor
		? []
		: [
				{
					id: 'refactor',
					skip: () => (sourceFiles({ run }).length === 0 ? 'no changed source files to review' : undefined),
					run: refactorStep({ run, gitPrefix, planContent, standards }),
				},
				{
					id: 'verify-refactor',
					run: verifyStep({
						run,
						gitPrefix,
						planContent,
						id: 'verify-refactor',
						coverage: true,
						buildFix: (errorContext) => buildRefactorExecutorInvocation({ planContent, changedFiles: sourceFiles({ run }), standards, errorContext }),
					}),
				},
			];

	return [
		{ id: 'clean-slate', run: cleanSlateStep({ run }) },
		{
			id: 'implement',
			run: workStep({
				run,
				gitPrefix,
				id: 'implement',
				requireChanges: true,
				build: () => buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands: run.config.agentCommands }),
			}),
		},
		{
			id: 'verify-implement',
			run: verifyStep({
				run,
				gitPrefix,
				planContent,
				id: 'verify-implement',
				buildFix: (errorContext) =>
					buildFeatureExecutorInvocation({
						planContent,
						overviewContent,
						standards,
						errorContext,
						changedFiles: run.current().changedFiles,
						allowedCommands: run.config.agentCommands,
					}),
			}),
		},
		{
			id: 'write-tests',
			skip: () => (sourceFiles({ run }).length === 0 ? 'no eligible source files' : undefined),
			run: writeTestsStep({ run, gitPrefix, planContent, testStandards }),
		},
		{
			id: 'verify-tests',
			run: verifyStep({
				run,
				gitPrefix,
				planContent,
				id: 'verify-tests',
				coverage: true,
				buildFix: (errorContext) =>
					buildUnitTestWriterInvocation({
						planContent,
						subjects: run.current().testSubjects,
						mustExecute: sourceFiles({ run }).filter((file) => !run.current().unreachableChangedFiles.includes(file)),
						standards: testStandards,
						errorContext,
					}),
			}),
		},
		...refactorSteps,
		formatStep({ run }),
	];
};
