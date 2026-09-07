import { isTestSideFile } from '#src/common/sourceFiles/isTestSideFile.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { buildImplementSteps } from '#src/pipeline/steps/buildSteps/common/utils/buildImplementSteps.ts';
import { buildLedgerLintSteps } from '#src/pipeline/steps/buildSteps/common/utils/buildLedgerLintSteps.ts';
import { buildRefactorSteps } from '#src/pipeline/steps/buildSteps/common/utils/buildRefactorSteps.ts';
import { buildTestSteps } from '#src/pipeline/steps/buildSteps/common/utils/buildTestSteps.ts';
import { cleanSlateStep } from '#src/pipeline/steps/cleanSlateStep.ts';
import { writeLedgerTestsStep } from '#src/pipeline/steps/writeLedgerTestsStep.ts';
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
		...buildLedgerLintSteps({ run, malformedLines: plan.malformedLedgerLines }),
		{ id: 'clean-slate', run: cleanSlateStep({ run, ledgerGates }) },
		{
			id: 'write-ledger-tests',
			skip: () => (plan.ledger.length === 0 ? 'the plan carries no acceptance-test ledger' : undefined),
			run: writeLedgerTestsStep({ run, gitPrefix, planContent, overviewContent, rows: plan.ledger, testStandards, movePaths, deletePaths }),
		},
		...buildImplementSteps({ run, gitPrefix, planContent, overviewContent, standards, fileLimit, acceptanceTests }),
		...buildTestSteps({ run, gitPrefix, planContent, overviewContent, testStandards, acceptanceTests, final: skipRefactor === true }),
		...buildRefactorSteps({ run, gitPrefix, planContent, overviewContent, standards, skipRefactor, acceptanceTests }),
	];
};
