import { PlanVariant } from '@lightsout/contracts';
import { runPlanDraft } from '@lightsout/engine';
import type { LightsoutConfig } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { getStringFlag } from '../common/args/getStringFlag';
import { bold } from '../common/terminal/bold';
import { dim } from '../common/terminal/dim';
import { green } from '../common/terminal/green';
import { red } from '../common/terminal/red';
import { yellow } from '../common/terminal/yellow';
import { createProgressPrinter } from '../common/utils/createProgressPrinter';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	plansDir: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
	flags: Map<string, string | true>;
}

export const planDraftCommand = async ({ cwd, driver, name, plansDir, standards, config, flags }: Params): Promise<void> => {
	const scopeFlag = getStringFlag({ flags, name: 'scope' });
	const scope = scopeFlag === 'phased' ? PlanVariant.Overview : scopeFlag === 'single' ? PlanVariant.Single : undefined;
	const result = await runPlanDraft({
		cwd,
		driver,
		name,
		plansDir,
		scope,
		standards,
		model: config?.model,
		effort: config?.effort,
		permissions: config?.permissions,
		onProgress: createProgressPrinter(),
	});

	if (result.status === 'paused-rate-limit' || result.status === 'failed') {
		console.error(`\n${result.error}`);
		process.exit(1);
	}

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
