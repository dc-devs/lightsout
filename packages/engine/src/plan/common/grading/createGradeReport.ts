import { type GradedGap, type GradeReport, type PhaseWeight, PlanGrade, PlanWeight, type StructuralFinding } from '#src/contracts/index.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { getBlockingGaps } from '#src/plan/common/utils/getBlockingGaps.ts';

interface Params {
	name: string;
	/** The `--phase` narrowing, when a human asked for one — recorded on the report's face. */
	phases?: string[];
	structural: StructuralFinding[];
	/** Every reader finding, already judged. */
	gaps: GradedGap[];
	/** One entry per reader or whole-plan checker that failed or was rate-limited; empty means every check finished. */
	failures: string[];
	/** The plan files every lens returned for. */
	phasesChecked: string[];
	/** Each graded plan file's weight and why, empty when the grade did not weigh anything. */
	weights?: PhaseWeight[];
	/** The plan files that weighed light, so no reader was spawned for them. */
	phasesLight?: string[];
	/** The commit `HEAD` was at when the pass ran; absent outside a git worktree. */
	commit?: string;
	/** Whether the working tree held uncommitted changes then; absent when the commit is. */
	treeDirty?: boolean;
}

/**
 * The verdict and the statement of what it covers, in one place. A pass is
 * complete only when nothing failed and nothing was withheld, and an incomplete
 * pass is never an A whatever it found. Advisory structural findings are
 * persisted but never decide the grade — an advisory is a note, not a defect.
 *
 * A pass is an A when nothing BLOCKING is left, not when nothing was found: a
 * finding a judge ruled the implementing agent can settle, or one it showed is
 * already answered, is recorded and gates nothing. A finding no judge settled
 * counts as blocking — failing closed costs one extra question, while failing
 * open lets an unweighed finding pass as a clean bill.
 *
 * `complete` speaks for the checks that READ the plan — the reader fan-out and
 * the whole-plan documentation checker alike. A judge that failed still does not
 * make a pass incomplete, because its finding already blocks on its own.
 *
 * `lenses` states what actually ran rather than what exists: it is the full lens
 * list when any plan file was read, and empty when every file weighed light. A
 * grade whose `lenses` is empty then reads as "no reader ran", never as "every
 * lens ran and found nothing".
 */
export const createGradeReport = ({
	name,
	phases,
	structural,
	gaps,
	failures,
	phasesChecked,
	weights = [],
	phasesLight = [],
	commit,
	treeDirty,
}: Params): GradeReport => {
	// Not "nothing was checked": a reader that failed also leaves `phasesChecked`
	// empty, and that pass did spawn its lenses. Only a weighing where every file
	// came out light means no reader ever ran.
	const everyFileLight = weights.length > 0 && weights.every(({ weight }) => weight === PlanWeight.Light);
	const narrowed = phases === undefined ? [] : [`graded a subset on request: ${phases.join(', ')} — the structural findings still cover every plan file`];
	const reasons = [...narrowed, ...failures];
	const complete = reasons.length === 0;
	const grade =
		complete && getBlockingFindings({ findings: structural }).length === 0 && getBlockingGaps({ gaps }).length === 0 ? PlanGrade.A : PlanGrade.BelowA;

	return {
		planName: name,
		grade,
		structural,
		gaps,
		phasesChecked,
		lenses: everyFileLight ? [] : gapCheckLenses,
		weights,
		phasesLight,
		complete,
		incompleteReason: complete ? undefined : reasons.join('; '),
		passed: grade === PlanGrade.A,
		gradedAt: new Date().toISOString(),
		gradedCommit: commit,
		gradedTreeDirty: treeDirty,
	};
};
