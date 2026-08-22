import { buildFeatureExecutorInvocation, buildRefactorExecutorInvocation, buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
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
interface RefactorPairParams {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	overviewContent?: string;
	standards?: string;
	skipRefactor?: boolean;
}

/**
 * The refactor pair: the standards-gated loop and the verification that follows
 * it, or nothing when the caller asked to skip them.
 *
 * Lifted out of `buildSteps` because it is the one part of that list with a
 * condition and a nested invocation builder of its own — the rest is a flat
 * sequence of step literals, and mixing the two made the function read as
 * though every step needed this much saying.
 *
 * Both entries scope on `standardsScopeFiles` rather than `sourceFiles`: the
 * gate judges findings on the test files a run wrote, so the executor has to be
 * allowed to write them, and a run whose only changed files are tests still has
 * standards to answer for.
 */
const refactorPair = ({ run, gitPrefix, planContent, overviewContent, standards, skipRefactor }: RefactorPairParams): PipelineStep[] =>
	skipRefactor
		? []
		: [
				{
					id: 'refactor',
					skip: () => (standardsScopeFiles({ run }).length === 0 ? 'no changed source files to review' : undefined),
					run: refactorStep({ run, gitPrefix, planContent, overviewContent, standards }),
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
							buildRefactorExecutorInvocation({
								scope: RefactorScope.Feature,
								planContent,
								overviewContent,
								changedFiles: standardsScopeFiles({ run }),
								standards,
								errorContext,
							}),
					}),
				},
			];

export const buildSteps = ({ run, gitPrefix, planContent, overviewContent, standards, testStandards, skipRefactor }: Params): PipelineStep[] => {
	const refactorSteps = refactorPair({ run, gitPrefix, planContent, overviewContent, standards, skipRefactor });

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
