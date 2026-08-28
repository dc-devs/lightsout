import { type GradedGap, type GradeReport, PlanGrade, type StructuralFinding } from '#src/contracts/index.ts';
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
	/** One entry per reader that failed or was rate-limited; empty means the fan-out finished. */
	failures: string[];
	/** The plan files every lens returned for. */
	phasesChecked: string[];
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
 * `complete` speaks for the READER fan-out alone. A judge that failed does not
 * make a pass incomplete, because its finding already blocks on its own.
 */
export const createGradeReport = ({ name, phases, structural, gaps, failures, phasesChecked, commit, treeDirty }: Params): GradeReport => {
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
		lenses: gapCheckLenses,
		complete,
		incompleteReason: complete ? undefined : reasons.join('; '),
		passed: grade === PlanGrade.A,
		gradedAt: new Date().toISOString(),
		gradedCommit: commit,
		gradedTreeDirty: treeDirty,
	};
};
