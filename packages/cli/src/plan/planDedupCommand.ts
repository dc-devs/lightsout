import { runPlanDedup } from '@lightsout/engine';
import type { LightsoutConfig } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { bold } from '../common/terminal/bold';
import { dim } from '../common/terminal/dim';
import { green } from '../common/terminal/green';
import { yellow } from '../common/terminal/yellow';
import { createProgressPrinter } from '../common/utils/createProgressPrinter';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	plansDir: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
}

export const planDedupCommand = async ({ cwd, driver, name, plansDir, standards, config }: Params): Promise<void> => {
	const result = await runPlanDedup({
		cwd,
		driver,
		name,
		plansDir,
		standards,
		model: config?.model,
		permissionMode: config?.permissionMode,
		onProgress: createProgressPrinter(),
	});

	if (result.status === 'paused-rate-limit' || result.status === 'failed') {
		console.error(`\n${result.error}`);
		process.exit(1);
	}

	const { dedup } = result;
	const count = dedup.findings.length;

	console.log(
		`\n${bold(`plan dedup ${name}`)} — ${count > 0 ? yellow(`${count} duplication(s) to review`) : green('no duplication found')} (reviewed ${dedup.reviewedAt})`,
	);

	for (const finding of dedup.findings) {
		console.log(`${yellow('⧉')} ${finding.plannedSymbol} [${finding.recommendation}] collides with ${finding.collidesWith.map((collision) => collision.path).join(', ')}`);
		console.log(dim(`   ${finding.rationale}`));
	}

	console.log(`\ndedup: ${result.dedupPath}`);
	process.exit(0);
};
