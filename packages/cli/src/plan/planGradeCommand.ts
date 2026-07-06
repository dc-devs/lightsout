import { runPlanGrade } from '@lightsout/engine';
import type { LightsoutConfig } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
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
}

export const planGradeCommand = async ({ cwd, driver, name, plansDir, standards, config }: Params): Promise<void> => {
	const result = await runPlanGrade({
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

	const { grade } = result;

	console.log(`\n${bold(`plan grade ${name}`)} — ${grade.passed ? green(grade.grade) : red(grade.grade)} (graded ${grade.gradedAt})`);
	console.log(`  structural: ${grade.structural.length} · gaps: ${grade.gaps.length}`);

	for (const finding of grade.structural) {
		console.log(`${yellow('⚠')} [${finding.check}] ${finding.location} — ${finding.issue}`);
		console.log(dim(`   fix: ${finding.fix}`));
	}

	for (const gap of grade.gaps) {
		console.log(`${yellow('?')} [${gap.area}] ${gap.gap}`);
		console.log(dim(`   decide: ${gap.decision}${gap.options.length > 0 ? ` — options: ${gap.options.join(' / ')}` : ''}`));
	}

	console.log(`\ngrade: ${result.gradePath}`);
	process.exit(0);
};
