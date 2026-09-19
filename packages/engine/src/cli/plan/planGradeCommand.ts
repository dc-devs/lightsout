import { printGradedGap } from '#src/cli/common/render/printGradedGap.ts';
import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { planRunOptions } from '#src/cli/plan/common/utils/planRunOptions.ts';
import { GapOutcome, type GradeReport, type LightsoutConfig, PlanningStep, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { getBlockingGaps, gradeHistoryPath, gradeMemoryPath, PlanRunStatus, recordPlanCommandRun, recordPlanningStep, runPlanGrade } from '#src/plan/index.ts';

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
 * The letter is the plan's verdict, not the step's outcome: a complete grade
 * exits 0 below whatever its letter, so it records as passed. Read by both
 * records, so the activity row and the planning step can never disagree.
 */
const gradeStatus = ({ result: graded }: { result: Awaited<ReturnType<typeof runPlanGrade>> }) =>
	graded.status === PlanRunStatus.PausedRateLimit
		? RunStatus.PausedRateLimit
		: graded.gradePath !== undefined && graded.grade?.complete === true
			? RunStatus.Passed
			: RunStatus.Failed;

/**
 * How far this pass reached and which rule chose that far — or, when nothing
 * ran, the recorded verdict and the one way to force a new baseline.
 */
const printScope = ({ grade, reused, memoryPath }: { grade: GradeReport; reused: boolean; memoryPath: string }) => {
	if (reused) {
		console.log(`  the recorded passing full review still covers the current inputs — nothing was re-run; delete ${memoryPath} to force a new baseline`);
		return;
	}

	const focus = grade.focusedOn.length > 0 ? ` — read ${grade.focusedOn.join(', ')}` : '';

	console.log(`  scope: ${grade.scope}${grade.scopeReason === undefined ? '' : ` — ${grade.scopeReason}`}${focus}`);
};

/**
 * What the verdict rests on, in three numbers rather than one: without the third
 * a human cannot tell an approval this pass read the whole plan for from one
 * granted mostly on earlier readings. It prints even when nothing stood, because
 * a reader comparing two runs needs the number to be there both times.
 */
const printCoverage = ({ grade }: { grade: GradeReport }) => {
	const stood = grade.covered.filter((phase) => !grade.phasesChecked.includes(phase) && !grade.phasesLight.includes(phase)).length;

	console.log(
		`  coverage: ${grade.covered.length} plan file(s) covered at their current text — ${grade.phasesChecked.length} read by this pass, ${stood} standing from an earlier pass`,
	);
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
 * Three paths are printed at the end: the grade path names the latest pass, the
 * history path names every pass this plan has ever had, and the memory path
 * names the record of what is still open and what was settled — the third file a
 * human opens after a grade.
 *
 * The scope line says how far the pass reached and which rule chose that far. A
 * reused review prints in its place: nothing ran, so there is no scope to
 * report, only the recorded verdict and the one way to force a new baseline.
 *
 * The coverage line beneath it says what the whole verdict rests on: how many of
 * the plan's files are covered at their current text, how many of those this pass
 * read, and how many stood from an earlier pass. Approval is granted from that
 * coverage, so a pass that read two files of five and still graded A has to be
 * legible as such rather than looking like a whole-plan review.
 */
export const planGradeCommand = async ({ cwd, driver, name, standards, config, phases }: Params): Promise<void> => {
	const result = await recordPlanCommandRun({
		cwd,
		name,
		label: 'plan grade',
		statusOf: gradeStatus,
		work: ({ level }) =>
			recordPlanningStep({
				cwd,
				name,
				step: PlanningStep.Grade,
				work: () => runPlanGrade({ ...planRunOptions({ cwd, driver, name, standards, config }), phases, level }),
				statusOf: gradeStatus,
			}),
	});

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

	const memoryPath = await gradeMemoryPath({ cwd, name });

	printScope({ grade, reused: 'reused' in result && result.reused === true, memoryPath });

	const blocking = getBlockingGaps({ gaps: grade.gaps });
	// The two kinds of blocking finding are counted apart: a spike in judge
	// failures must not read as a plan getting worse.
	const unjudged = blocking.filter((gap) => gap.outcome === GapOutcome.Unjudged).length;

	console.log(`  structural: ${grade.structural.length} · gaps: ${grade.gaps.length} (${blocking.length} blocking, ${unjudged} unjudged)`);
	// `N phase file(s)` rather than `all plan files`: overview.md is never
	// gap-checked, so the coverage line must not imply it was.
	const checked = grade.phasesChecked.length > 0 ? `: ${grade.phasesChecked.join(', ')}` : '';

	console.log(`  checked: ${grade.phasesChecked.length} phase file(s) × ${grade.lenses.length} lens(es)${checked}`);
	printCoverage({ grade });
	printWeights({ weights: grade.weights });

	for (const finding of grade.structural) {
		printStructuralFinding({ finding });
	}

	printGaps({ gaps: blocking });

	console.log(`\ngrade: ${gradePath}`);
	console.log(`history: ${await gradeHistoryPath({ cwd, name })}`);
	console.log(`memory: ${memoryPath}`);
	return exitCli({ code: grade.complete ? 0 : 1 });
};
