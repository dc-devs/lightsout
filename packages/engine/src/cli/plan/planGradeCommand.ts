import { printStructuralFinding } from '@/cli/common/render/printStructuralFinding';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';
import { exitCli } from '@/cli/common/utils/exitCli';
import { exitOnPlanFailure } from '@/cli/plan/common/utils/exitOnPlanFailure';
import { planRunOptions } from '@/cli/plan/common/utils/planRunOptions';
import type { LightsoutConfig } from '@/contracts';
import type { Driver } from '@/drivers';
import { runPlanGrade } from '@/plan';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
}

export const planGradeCommand = async ({ cwd, driver, name, standards, config }: Params): Promise<void> => {
	const result = await exitOnPlanFailure(await runPlanGrade(planRunOptions({ cwd, driver, name, standards, config })));

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
