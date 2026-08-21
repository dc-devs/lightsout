import { buildFeatureExecutorInvocation, buildRefactorExecutorInvocation, buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { cleanSlateStep } from '#src/pipeline/steps/cleanSlateStep.ts';
import { formatStep } from '#src/pipeline/steps/formatStep.ts';
import { refactorStep } from '#src/pipeline/steps/refactorStep.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep.ts';
import { workStep } from '#src/pipeline/steps/workStep.ts';
import { writeTestsStep } from '#src/pipeline/steps/writeTestsStep.ts';

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
						buildFix: (errorContext) =>
							buildRefactorExecutorInvocation({ scope: RefactorScope.Feature, planContent, changedFiles: sourceFiles({ run }), standards, errorContext }),
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
				build: () => buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands: run.config['agent-commands'] }),
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
						allowedCommands: run.config['agent-commands'],
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
