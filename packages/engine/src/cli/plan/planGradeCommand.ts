import { printGradedGap } from '#src/cli/common/render/printGradedGap.ts';
import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { planRunOptions } from '#src/cli/plan/common/utils/planRunOptions.ts';
import { GapOutcome, type GradeReport, type LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { getBlockingGaps, gradeHistoryPath, runPlanGrade } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
	/** The `--phase` values, already split and trimmed; absent grades every plan file. */
	phases?: string[];
}

/**
 * Print the gaps in the phase-then-lens order the runner stamped them in, under
 * a heading per plan file. It is handed the BLOCKING gaps alone: a human is
 * shown what they have to act on, and the notes a judge cleared stay in
 * `grade.json` where a human or a later agent can read them.
 */
const printGaps = ({ gaps }: { gaps: GradeReport['gaps'] }) => {
	let heading: string | undefined;

	for (const gap of gaps) {
		if (gap.phase !== heading) {
			heading = gap.phase;
			console.log(bold(heading));
		}

		printGradedGap({ gap });
	}
};

/**
 * One line per weighed plan file: what it weighed, and every threshold it
 * crossed. Nothing is printed when the grade weighed nothing, which is every
 * grade taken with `plan.contract` off.
 */
const printWeights = ({ weights }: { weights: GradeReport['weights'] }) => {
	for (const { phase, weight, reasons } of weights) {
		console.log(`  weight: ${phase} — ${weight}${reasons.length > 0 ? ` (${reasons.join('; ')})` : ''}`);
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
 *
 * Two paths are printed at the end: the grade path names the latest pass, and
 * the history path names every pass this plan has ever had, so a human can open
 * either.
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

	// Three branches, not two: an unknown tree state must not render identically to
	// a clean one, or a grade whose tree was never read reads as one taken on a
	// clean tree. Twelve characters is the short sha a human compares against
	// `git log`; the full sha stays in grade.json.
	const treeState = grade.gradedTreeDirty === undefined ? ', tree state unknown' : grade.gradedTreeDirty ? ' plus uncommitted changes' : '';
	const measuredAgainst = grade.gradedCommit === undefined ? 'outside a git worktree' : `at ${grade.gradedCommit.slice(0, 12)}${treeState}`;

	console.log(`\n${bold(`plan grade ${name}`)} — ${grade.passed ? green(grade.grade) : red(grade.grade)} (graded ${grade.gradedAt}, ${measuredAgainst})`);
	const blocking = getBlockingGaps({ gaps: grade.gaps });
	// The two kinds of blocking finding are counted apart: a spike in judge
	// failures must not read as a plan getting worse.
	const unjudged = blocking.filter((gap) => gap.outcome === GapOutcome.Unjudged).length;

	console.log(`  structural: ${grade.structural.length} · gaps: ${grade.gaps.length} (${blocking.length} blocking, ${unjudged} unjudged)`);
	// `N phase file(s)` rather than `all plan files`: overview.md is never
	// gap-checked, so the coverage line must not imply it was.
	const checked = grade.phasesChecked.length > 0 ? `: ${grade.phasesChecked.join(', ')}` : '';

	console.log(`  checked: ${grade.phasesChecked.length} phase file(s) × ${grade.lenses.length} lens(es)${checked}`);
	printWeights({ weights: grade.weights });

	for (const finding of grade.structural) {
		printStructuralFinding({ finding });
	}

	printGaps({ gaps: blocking });

	console.log(`\ngrade: ${gradePath}`);
	console.log(`history: ${gradeHistoryPath({ cwd, name })}`);
	return exitCli({ code: grade.complete ? 0 : 1 });
};
