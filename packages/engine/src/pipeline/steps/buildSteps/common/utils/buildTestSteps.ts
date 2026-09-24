import { buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import type { AcceptanceTestRecord, RenameRule } from '#src/contracts/index.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import type { FixBuilder } from '#src/pipeline/steps/common/types/FixBuilder.ts';
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
	/** The plan's declared renames; empty for every plan that is not rename-only. */
	renames: RenameRule[];
	/** The feature executor's fix re-invocation, which repairs a rename-only plan's verify-tests in place of the unit-test writer. */
	featureFix: FixBuilder;
}

/**
 * The unit-test trio: the writer fan-out, the formatter, and the verification
 * that re-invokes a test writer when a gate fails. The fan-out is skipped when
 * the run changed no source file a test could target, and for a rename-only
 * plan, which writes no tests — its verify-tests repair goes to the feature
 * executor instead.
 */
export const buildTestSteps = ({
	run,
	gitPrefix,
	planContent,
	overviewContent,
	testStandards,
	acceptanceTests,
	final,
	renames,
	featureFix,
}: Params): PipelineStep[] => [
	{
		id: 'write-tests',
		skip: () => {
			if (renames.length > 0) {
				return 'the plan is rename-only, and a rename-only phase writes no tests';
			}

			return sourceFiles({ run }).length === 0 ? 'no eligible source files' : undefined;
		},
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
			renames,
			buildFix:
				renames.length > 0
					? featureFix
					: ({ errorContext }) =>
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
