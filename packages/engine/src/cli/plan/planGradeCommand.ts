import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { planRunOptions } from '#src/cli/plan/common/utils/planRunOptions.ts';
import type { GradeReport, LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanGrade } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
	/** The `--phase` values, already split and trimmed; absent grades every plan file. */
	phases?: string[];
}

/** Print the gaps in the phase-then-lens order the runner stamped them in, under a heading per plan file. */
const printGaps = ({ gaps }: { gaps: GradeReport['gaps'] }) => {
	let heading: string | undefined;

	for (const gap of gaps) {
		if (gap.phase !== heading) {
			heading = gap.phase;
			console.log(bold(heading));
		}

		console.log(`${yellow('?')} [${gap.area}] ${gap.gap} ${dim(`(${gap.lens})`)}`);
		console.log(dim(`   decide: ${gap.decision}${gap.options.length > 0 ? ` — options: ${gap.options.join(' / ')}` : ''}`));
	}
};

/**
 * `plan grade` at the terminal.
 *
 * The failure branches are handled here rather than through `exitOnPlanFailure`
 * because a failed or parked run now leaves a real partial report on disk: the
 * helper prints the error and exits before the caller ever sees it, which would
 * throw that report away. An incomplete pass exits 1 — it is not a pass, and a
 * script must be able to tell — while a complete grade exits 0 whatever its
 * verdict.
 */
export const planGradeCommand = async ({ cwd, driver, name, standards, config, phases }: Params): Promise<void> => {
	const result = await runPlanGrade({ ...planRunOptions({ cwd, driver, name, standards, config }), phases });

	if ('error' in result) {
		console.error(`\n${result.error}`);
	}

	const grade = 'grade' in result ? result.grade : undefined;
	const gradePath = 'gradePath' in result ? result.gradePath : undefined;

	// Nothing was written — the deliverable did not resolve, or `--phase` named
	// no plan file. The error above is the whole report.
	if (grade === undefined || gradePath === undefined) {
		return exitCli({ code: 1 });
	}

	if (!grade.complete) {
		console.log(`\n${yellow('incomplete grade')} — ${grade.incompleteReason ?? 'the pass did not finish'}`);
	}

	console.log(`\n${bold(`plan grade ${name}`)} — ${grade.passed ? green(grade.grade) : red(grade.grade)} (graded ${grade.gradedAt})`);
	console.log(`  structural: ${grade.structural.length} · gaps: ${grade.gaps.length}`);
	// `N phase file(s)` rather than `all plan files`: overview.md is never
	// gap-checked, so the coverage line must not imply it was.
	const checked = grade.phasesChecked.length > 0 ? `: ${grade.phasesChecked.join(', ')}` : '';

	console.log(`  checked: ${grade.phasesChecked.length} phase file(s) × ${grade.lenses.length} lens(es)${checked}`);

	for (const finding of grade.structural) {
		printStructuralFinding({ finding });
	}

	printGaps({ gaps: grade.gaps });

	console.log(`\ngrade: ${gradePath}`);
	return exitCli({ code: grade.complete ? 0 : 1 });
};
