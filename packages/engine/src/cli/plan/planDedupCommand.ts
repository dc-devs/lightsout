import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
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

/**
 * `plan dedup` at the terminal.
 *
 * The failure branches are handled here rather than through `exitOnPlanFailure`
 * for the reason `plan grade`'s are: a failed judge now leaves a real partial
 * report on disk, and the helper would exit before the caller could print it.
 */
export const planDedupCommand = async ({ cwd, driver, name, standards, config }: Params): Promise<void> => {
	const result = await runPlanDedup(planRunOptions({ cwd, driver, name, standards, config }));

	if ('error' in result) {
		console.error(`\n${result.error}`);
	}

	const dedup = 'dedup' in result ? result.dedup : undefined;
	const dedupPath = 'dedupPath' in result ? result.dedupPath : undefined;

	// Nothing was written — the deliverable did not resolve. The error above is
	// the whole report.
	if (dedup === undefined || dedupPath === undefined) {
		return exitCli({ code: 1 });
	}

	const count = dedup.findings.length;

	if (!dedup.complete) {
		console.log(`\n${yellow('incomplete scan')} — ${dedup.incompleteReason ?? 'the pass did not finish'}`);
	}

	console.log(
		`\n${bold(`plan dedup ${name}`)} — ${count > 0 ? yellow(`${count} duplication(s) to review`) : green('no duplication found')} (reviewed ${dedup.reviewedAt})`,
	);

	for (const finding of dedup.findings) {
		console.log(
			`${yellow('⧉')} ${finding.phase} · ${finding.plannedSymbol} [${finding.recommendation}] collides with ${finding.collidesWith.map((collision) => collision.path).join(', ')}`,
		);
		console.log(dim(`   ${finding.rationale}`));
	}

	console.log(`\ndedup: ${dedupPath}`);
	return exitCli({ code: dedup.complete ? 0 : 1 });
};
