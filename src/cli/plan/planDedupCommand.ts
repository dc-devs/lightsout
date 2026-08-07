import { runPlanDedup } from '@/plan';
import type { LightsoutConfig } from '@/contracts';
import type { Driver } from '@/drivers';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { yellow } from '@/cli/common/terminal/yellow';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { planRunOptions } from '@/cli/plan/common/utils/planRunOptions';
import { exitOnPlanFailure } from '@/cli/plan/common/utils/exitOnPlanFailure';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	plansDir: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
}

export const planDedupCommand = async ({ cwd, driver, name, plansDir, standards, config }: Params): Promise<void> => {
	const result = await runPlanDedup(planRunOptions({ cwd, driver, name, plansDir, standards, config }));

	exitOnPlanFailure(result);

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
