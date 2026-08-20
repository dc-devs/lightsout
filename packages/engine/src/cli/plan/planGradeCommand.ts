import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitOnPlanFailure } from '#src/cli/plan/common/utils/exitOnPlanFailure.ts';
import { planRunOptions } from '#src/cli/plan/common/utils/planRunOptions.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanGrade } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
}

export const planGradeCommand = async ({ cwd, driver, name, standards, config }: Params): Promise<void> => {
	const result = await exitOnPlanFailure({ result: await runPlanGrade(planRunOptions({ cwd, driver, name, standards, config })) });

	const { grade } = result;

	console.log(`\n${bold(`plan grade ${name}`)} — ${grade.passed ? green(grade.grade) : red(grade.grade)} (graded ${grade.gradedAt})`);
	console.log(`  structural: ${grade.structural.length} · gaps: ${grade.gaps.length}`);

	for (const finding of grade.structural) {
		printStructuralFinding({ finding });
	}

	for (const gap of grade.gaps) {
		console.log(`${yellow('?')} [${gap.area}] ${gap.gap}`);
		console.log(dim(`   decide: ${gap.decision}${gap.options.length > 0 ? ` — options: ${gap.options.join(' / ')}` : ''}`));
	}

	console.log(`\ngrade: ${result.gradePath}`);
	return exitCli({ code: 0 });
};
