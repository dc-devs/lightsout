import { buildFeatureExecutorInvocation, buildRefactorExecutorInvocation, buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { cleanSlateStep } from '#src/pipeline/steps/cleanSlateStep.ts';
import { formatStep } from '#src/pipeline/steps/formatStep.ts';
import { refactorStep } from '#src/pipeline/steps/refactorStep.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep.ts';
import { workStep } from '#src/pipeline/steps/workStep.ts';
import { writeLedgerTestsStep } from '#src/pipeline/steps/writeLedgerTestsStep.ts';
import { writeTestsStep } from '#src/pipeline/steps/writeTestsStep.ts';
import { parsePlan } from '#src/plan/index.ts';

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
 * The refactor steps: the standards-gated loop, formatter, and verification,
 * or nothing when the caller asked to skip them.
 *
 * Lifted out of `buildSteps` because it is the one part of that list with a
 * condition and a nested invocation builder of its own — the rest is a flat
 * sequence of step literals, and mixing the two made the function read as
 * though every step needed this much saying.
 *
 * The code-writing entries scope on `standardsScopeFiles` rather than `sourceFiles`: the
 * gate judges findings on the test files a run wrote, so the executor has to be
 * allowed to write them, and a run whose only changed files are tests still has
 * standards to answer for.
 */
const refactorSteps = ({ run, gitPrefix, planContent, overviewContent, standards, skipRefactor }: Omit<Params, 'testStandards'>): PipelineStep[] =>
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
						id: 'verify-refactor',
						coverage: true,
						buildFix: ({ errorContext }) =>
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

/**
 * A plan whose ledger rows are malformed stops the run before anything else:
 * the plan-time lint gives that verdict, and implement must not be more lenient
 * about the same defect. A well-formed ledger contributes no step at all.
 */
const ledgerLintSteps = ({ run, malformedLines }: { run: PipelineRun; malformedLines: number[] }): PipelineStep[] =>
	malformedLines.length === 0
		? []
		: [
				{
					id: 'check-ledger',
					run: async () =>
						run.stop({
							record: run.nextRecord({ id: 'check-ledger' }),
							status: RunStatus.Failed,
							error: `check-ledger: the plan's acceptance-test ledger has row(s) the engine cannot read, at line(s) ${malformedLines.join(', ')} — fix them in the plan and re-run.`,
						}),
				},
			];

/**
 * The implement trio: the executor build, the formatter, and the verification
 * that re-invokes the executor when a gate fails.
 */
const implementSteps = ({
	run,
	gitPrefix,
	planContent,
	overviewContent,
	standards,
	fileLimit,
	ledgerTests,
}: Omit<Params, 'testStandards' | 'skipRefactor'> & { fileLimit: number | undefined; ledgerTests: () => string[] }): PipelineStep[] => [
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
					ledgerTests: ledgerTests(),
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
			id: 'verify-implement',
			buildFix: ({ errorContext }) =>
				buildFeatureExecutorInvocation({
					planContent,
					overviewContent,
					standards,
					errorContext,
					changedFiles: run.current().changedFiles,
					allowedCommands: run.config['agent-commands'],
					fileLimit,
					ledgerTests: ledgerTests(),
				}),
		}),
	},
];

/**
 * The unit-test trio: the writer fan-out, the formatter, and the verification
 * that re-invokes a test writer when a gate fails. The fan-out is skipped when
 * the run changed no source file a test could target.
 */
const testSteps = ({
	run,
	gitPrefix,
	planContent,
	testStandards,
	ledgerTests,
}: Pick<Params, 'run' | 'gitPrefix' | 'planContent' | 'testStandards'> & { ledgerTests: () => string[] }): PipelineStep[] => [
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
			id: 'verify-tests',
			coverage: true,
			buildFix: ({ errorContext }) =>
				buildUnitTestWriterInvocation({
					planContent,
					subjects: run.current().testSubjects,
					mustExecute: sourceFiles({ run }).filter(
						(file) => !run.current().unreachableChangedFiles.includes(file) && !run.current().coverageExcludedChangedFiles.includes(file),
					),
					standards: testStandards,
					errorContext,
					ledgerTests: ledgerTests(),
				}),
		}),
	},
];

/**
 * The pipeline's step sequence, assembled with formatting after each writing
 * phase and before its verification, with the refactor steps dropped when
 * skipRefactor asks for it.
 */
export const buildSteps = ({ run, gitPrefix, planContent, overviewContent, standards, testStandards, skipRefactor }: Params): PipelineStep[] => {
	// The number the plan graded against is the number it is run against: a phase
	// that renames an import across two hundred files declares its own budget,
	// and one repo-wide setting cannot express that without weakening the
	// guardrail for every other plan. `base` is a variant hint only, and the
	// content here is always an implementable plan — never an overview.
	const plan = parsePlan({ content: planContent, base: 'plan.md' });
	const fileLimit = plan.fileBudget ?? run.config['executor-file-limit'];
	// Read at build time on every invocation, so a fix re-invocation names the
	// files the ledger step locked rather than the empty list it started from.
	const ledgerTests = () => run.current().ledgerTests.map((record) => record.path);

	return [
		...ledgerLintSteps({ run, malformedLines: plan.malformedLedgerLines }),
		{ id: 'clean-slate', run: cleanSlateStep({ run }) },
		{
			id: 'write-ledger-tests',
			skip: () => (plan.ledger.length === 0 ? 'the plan carries no acceptance-test ledger' : undefined),
			run: writeLedgerTestsStep({ run, gitPrefix, planContent, overviewContent, rows: plan.ledger, testStandards }),
		},
		...implementSteps({ run, gitPrefix, planContent, overviewContent, standards, fileLimit, ledgerTests }),
		...testSteps({ run, gitPrefix, planContent, testStandards, ledgerTests }),
		...refactorSteps({ run, gitPrefix, planContent, overviewContent, standards, skipRefactor }),
	];
};
