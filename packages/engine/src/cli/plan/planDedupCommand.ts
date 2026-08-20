import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitOnPlanFailure } from '#src/cli/plan/common/utils/exitOnPlanFailure.ts';
import { planRunOptions } from '#src/cli/plan/common/utils/planRunOptions.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanDedup } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
}

export const planDedupCommand = async ({ cwd, driver, name, standards, config }: Params): Promise<void> => {
	const result = await exitOnPlanFailure({ result: await runPlanDedup(planRunOptions({ cwd, driver, name, standards, config })) });

	const { dedup } = result;
	const count = dedup.findings.length;

	console.log(
		`\n${bold(`plan dedup ${name}`)} — ${count > 0 ? yellow(`${count} duplication(s) to review`) : green('no duplication found')} (reviewed ${dedup.reviewedAt})`,
	);

	for (const finding of dedup.findings) {
		console.log(
			`${yellow('⧉')} ${finding.plannedSymbol} [${finding.recommendation}] collides with ${finding.collidesWith.map((collision) => collision.path).join(', ')}`,
		);
		console.log(dim(`   ${finding.rationale}`));
	}

	console.log(`\ndedup: ${result.dedupPath}`);
	return exitCli({ code: 0 });
};
