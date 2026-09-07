import { buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import type { AcceptanceTestRecord } from '#src/contracts/index.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { formatStep } from '#src/pipeline/steps/formatStep.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/index.ts';
import { writeTestsStep } from '#src/pipeline/steps/writeTestsStep.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	overviewContent?: string;
	testStandards?: string;
	/** Read at every call rather than captured once, so a re-invocation names the ledger rows as they now stand. */
	acceptanceTests: () => AcceptanceTestRecord[];
	/** True when the refactor steps are skipped, making this checkpoint the run's last verification. */
	final: boolean;
}

/**
 * The unit-test trio: the writer fan-out, the formatter, and the verification
 * that re-invokes a test writer when a gate fails. The fan-out is skipped when
 * the run changed no source file a test could target.
 */
export const buildTestSteps = ({ run, gitPrefix, planContent, overviewContent, testStandards, acceptanceTests, final }: Params): PipelineStep[] => [
	{
		id: 'write-tests',
		skip: () => (sourceFiles({ run }).length === 0 ? 'no eligible source files' : undefined),
		run: writeTestsStep({ run, gitPrefix, planContent, testStandards }),
	},
	formatStep({ run, id: 'format-tests' }),
	{
		id: 'verify-tests',
		run: verifyStep({
			run,
			gitPrefix,
			planContent,
			overviewContent,
			id: 'verify-tests',
			coverage: true,
			acceptanceTests,
			final,
			buildFix: ({ errorContext }) =>
				buildUnitTestWriterInvocation({
					planContent,
					subjects: run.current().testSubjects,
					mustExecute: sourceFiles({ run }).filter(
						(file) => !run.current().unreachableChangedFiles.includes(file) && !run.current().coverageExcludedChangedFiles.includes(file),
					),
					standards: testStandards,
					errorContext,
					acceptanceTests: acceptanceTests(),
				}),
		}),
	},
];
