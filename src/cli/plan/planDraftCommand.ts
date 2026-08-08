import { PlanVariant } from '@/contracts';
import { runPlanDraft } from '@/plan';
import type { LightsoutConfig } from '@/contracts';
import type { Driver } from '@/drivers';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';
import { planRunOptions } from '@/cli/plan/common/utils/planRunOptions';
import { exitOnPlanFailure } from '@/cli/plan/common/utils/exitOnPlanFailure';

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
	const result = await runPlanDraft({ ...planRunOptions({ cwd, driver, name, standards, config }), scope });

	exitOnPlanFailure(result);

	if (result.status === 'facts-error') {
		console.error(`\n${red('facts error')} — the plan-writer found the facts/decisions do not match the codebase. Re-explore, then re-draft:`);

		for (const discrepancy of result.discrepancies) {
			console.error(`  ${yellow('⚠')} ${discrepancy}`);
		}

		process.exit(1);
	}

	if (result.status === 'structural-issues') {
		console.error(`\n${red(`${result.findings.length} structural issue(s)`)} remain after re-drafting — resolve, then re-draft:`);

		for (const finding of result.findings) {
			console.error(`  ${yellow('⚠')} [${finding.check}] ${finding.location} — ${finding.issue}`);
			console.error(dim(`     fix: ${finding.fix}`));
		}

		process.exit(1);
	}

	console.log(`\n${bold(`plan draft ${name}`)} — ${result.variant}, structurally clean`);

	for (const path of result.planPaths) {
		console.log(`  ${green('✓')} ${path}`);
	}

	process.exit(0);
};
