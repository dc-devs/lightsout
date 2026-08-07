import { runPlanGrade } from '@/plan';
import type { LightsoutConfig } from '@/contracts';
import type { Driver } from '@/drivers';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { printStructuralFinding } from '@/cli/common/render/printStructuralFinding';
import { red } from '@/cli/common/terminal/red';
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

export const planGradeCommand = async ({ cwd, driver, name, plansDir, standards, config }: Params): Promise<void> => {
	const result = await runPlanGrade(planRunOptions({ cwd, driver, name, plansDir, standards, config }));

	exitOnPlanFailure(result);

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
	process.exit(0);
};
