import { buildFeatureExecutorInvocation, buildRefactorExecutorInvocation, buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { isTestSideFile } from '#src/common/sourceFiles/isTestSideFile.ts';
import { type AcceptanceTestRecord, RunStatus } from '#src/contracts/index.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { cleanSlateStep } from '#src/pipeline/steps/cleanSlateStep.ts';
import { formatStep } from '#src/pipeline/steps/formatStep.ts';
import { refactorStep } from '#src/pipeline/steps/refactorStep.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/index.ts';
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
 * sequence of step literals, and mixing the two read as though every step
 * needed this much saying.
 *
 * The code-writing entries scope on `standardsScopeFiles` rather than
 * `sourceFiles`: the gate judges findings on the test files a run wrote, so a
 * run whose only changed files are tests still has standards to answer for.
 */
const refactorSteps = ({
	run,
	gitPrefix,
	planContent,
	overviewContent,
	standards,
	skipRefactor,
	acceptanceTests,
}: Omit<Params, 'testStandards'> & { acceptanceTests: () => AcceptanceTestRecord[] }): PipelineStep[] =>
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
							}),
					}),
				},
			];

/**
 * A plan whose ledger rows are malformed stops the run before anything else: the
 * plan-time lint gives that verdict, and implement must not be more lenient
 * about it. A well-formed ledger contributes no step at all.
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

/** The implement trio: the executor build, the formatter, and the verification that re-invokes the executor when a gate fails. */
const implementSteps = ({
	run,
	gitPrefix,
	planContent,
	overviewContent,
	standards,
	fileLimit,
	acceptanceTests,
}: Omit<Params, 'testStandards' | 'skipRefactor'> & {
	fileLimit: number | undefined;
	acceptanceTests: () => AcceptanceTestRecord[];
}): PipelineStep[] => [
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
	overviewContent,
	testStandards,
	acceptanceTests,
	final,
}: Pick<Params, 'run' | 'gitPrefix' | 'planContent' | 'overviewContent' | 'testStandards'> & {
	acceptanceTests: () => AcceptanceTestRecord[];
	/** True when the refactor steps are skipped, making this checkpoint the run's last verification. */
	final: boolean;
}): PipelineStep[] => [
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

/**
 * The pipeline's step sequence, assembled with formatting after each writing
 * phase and before its verification, with the refactor steps dropped when
 * skipRefactor asks for it.
 */
export const buildSteps = ({ run, gitPrefix, planContent, overviewContent, standards, testStandards, skipRefactor }: Params): PipelineStep[] => {
	// The number the plan graded against is the number it is run against: a phase
	// that renames an import across two hundred files declares its own budget, and
	// one repo-wide setting cannot express that without weakening the guardrail for
	// every other plan. `base` is a variant hint only, and the content here is
	// always an implementable plan — never an overview.
	const plan = parsePlan({ content: planContent, base: 'plan.md' });
	const fileLimit = plan.fileBudget ?? run.config['executor-file-limit'];
	// Read from the manifest at every call rather than captured once: the ledger
	// step seeds this mapping and an approved disposition rewrites it, so every
	// gate run and every fix re-invocation names the rows as they now stand.
	const acceptanceTests = () => run.current().acceptanceTests;
	const ledgerGates = [...new Set(plan.ledger.map((row) => row.gate))];
	// A move destination the ledger writer writes carries every case its source
	// held, and a file the plan deletes is nowhere to put a named test.
	const movePaths = plan.movePaths.filter((move) => isTestSideFile({ path: move.to }));
	const deletePaths = plan.deletePaths.filter((path) => isTestSideFile({ path }));

	return [
		...ledgerLintSteps({ run, malformedLines: plan.malformedLedgerLines }),
		{ id: 'clean-slate', run: cleanSlateStep({ run, ledgerGates }) },
		{
			id: 'write-ledger-tests',
			skip: () => (plan.ledger.length === 0 ? 'the plan carries no acceptance-test ledger' : undefined),
			run: writeLedgerTestsStep({ run, gitPrefix, planContent, overviewContent, rows: plan.ledger, testStandards, movePaths, deletePaths }),
		},
		...implementSteps({ run, gitPrefix, planContent, overviewContent, standards, fileLimit, acceptanceTests }),
		...testSteps({ run, gitPrefix, planContent, overviewContent, testStandards, acceptanceTests, final: skipRefactor === true }),
		...refactorSteps({ run, gitPrefix, planContent, overviewContent, standards, skipRefactor, acceptanceTests }),
	];
};
