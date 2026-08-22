import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitOnPlanFailure } from '#src/cli/plan/common/utils/exitOnPlanFailure.ts';
import { planRunOptions } from '#src/cli/plan/common/utils/planRunOptions.ts';
import type { LightsoutConfig, StructuralFinding } from '#src/contracts/index.ts';
import { PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { getBlockingFindings, PlanRunStatus, runPlanDraft } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
	flags: Map<string, string | true>;
}

/**
 * Advisories gate nothing, so however the draft ended is where they get read at
 * all — beneath the written paths on success, beneath the errors otherwise.
 * Computed, persisted and never seen is the failure this exists to prevent: one
 * of them is the over-eight-phases note, whose whole job is telling the human
 * how many decisions the review will put in front of them.
 */
const printPlanAdvisories = ({ advisories }: { advisories: StructuralFinding[] }) => {
	for (const finding of advisories) {
		printStructuralFinding({ finding });
	}
};

export const planDraftCommand = async ({ cwd, driver, name, standards, config, flags }: Params): Promise<void> => {
	const scopeFlag = getStringFlag({ flags, name: 'scope' });
	const scope = scopeFlag === 'phased' ? PlanVariant.Overview : scopeFlag === 'single' ? PlanVariant.Single : undefined;
	const result = await exitOnPlanFailure({ result: await runPlanDraft({ ...planRunOptions({ cwd, driver, name, standards, config }), scope }) });

	if (result.status === PlanRunStatus.FactsError) {
		console.error(`\n${red('facts error')} — the plan-writer found the facts/decisions do not match the codebase. Re-explore, then re-draft:`);

		for (const discrepancy of result.discrepancies) {
			console.error(`  ${yellow('⚠')} ${discrepancy}`);
		}

		printPlanAdvisories({ advisories: result.advisories });

		return exitCli({ code: 1 });
	}

	// A refused phase breakdown surfaces here too, so each line leads with the
	// plan file the finding is in — on a phased draft that is the difference
	// between a navigable list and twenty unattributed lines.
	if (result.status === PlanRunStatus.StructuralIssues) {
		const blocking = getBlockingFindings({ findings: result.findings });

		console.error(`\n${red(`${blocking.length} structural issue(s)`)} remain after re-drafting — resolve, then re-draft:`);

		for (const finding of blocking) {
			printStructuralFinding({ finding, write: console.error });
		}

		printPlanAdvisories({ advisories: result.advisories });

		return exitCli({ code: 1 });
	}

	console.log(`\n${bold(`plan draft ${name}`)} — ${result.variant}, structurally clean`);

	for (const path of result.planPaths) {
		console.log(`  ${green('✓')} ${path}`);
	}

	printPlanAdvisories({ advisories: result.advisories });

	return exitCli({ code: 0 });
};
