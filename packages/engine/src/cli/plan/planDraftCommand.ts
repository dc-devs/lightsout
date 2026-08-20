import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitOnPlanFailure } from '#src/cli/plan/common/utils/exitOnPlanFailure.ts';
import { planRunOptions } from '#src/cli/plan/common/utils/planRunOptions.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
	flags: Map<string, string | true>;
}

export const planDraftCommand = async ({ cwd, driver, name, standards, config, flags }: Params): Promise<void> => {
	const scopeFlag = getStringFlag({ flags, name: 'scope' });
	const scope = scopeFlag === 'phased' ? PlanVariant.Overview : scopeFlag === 'single' ? PlanVariant.Single : undefined;
	const result = await exitOnPlanFailure({ result: await runPlanDraft({ ...planRunOptions({ cwd, driver, name, standards, config }), scope }) });

	if (result.status === 'facts-error') {
		console.error(`\n${red('facts error')} — the plan-writer found the facts/decisions do not match the codebase. Re-explore, then re-draft:`);

		for (const discrepancy of result.discrepancies) {
			console.error(`  ${yellow('⚠')} ${discrepancy}`);
		}

		return exitCli({ code: 1 });
	}

	if (result.status === 'structural-issues') {
		console.error(`\n${red(`${result.findings.length} structural issue(s)`)} remain after re-drafting — resolve, then re-draft:`);

		for (const finding of result.findings) {
			console.error(`  ${yellow('⚠')} [${finding.check}] ${finding.location} — ${finding.issue}`);
			console.error(dim(`     fix: ${finding.fix}`));
		}

		return exitCli({ code: 1 });
	}

	console.log(`\n${bold(`plan draft ${name}`)} — ${result.variant}, structurally clean`);

	for (const path of result.planPaths) {
		console.log(`  ${green('✓')} ${path}`);
	}

	return exitCli({ code: 0 });
};
