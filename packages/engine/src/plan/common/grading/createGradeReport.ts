import {
	GapOutcome,
	type GradedGap,
	type GradeInputs,
	type GradeReport,
	GradeScope,
	type PhaseWeight,
	PlanGrade,
	type StructuralFinding,
} from '#src/contracts/index.ts';
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
	/** How far this pass reached. A focused pass is a repair check and is recorded as incomplete whatever it found. */
	scope?: GradeScope;
	/** The plan files a focused pass read. Empty on a full pass. */
	focusedOn?: string[];
	/** The fingerprint of everything this pass measured. */
	inputs?: GradeInputs;
	/** One line naming the rule that chose this pass's scope. */
	scopeReason?: string;
	/** The plan files this pass owed a reader — what `lenses` states, and what `scopeComplete` holds `phasesChecked` against. */
	phasesRequired: string[];
	/** Whether the whole-plan documentation checker finished, or had nothing to do on this pass. */
	documentationComplete: boolean;
}

/**
 * Whether every check this pass's own scope called for finished — the question
 * the repair baseline asks, and a narrower one than `complete`.
 *
 * It is computed from positive per-file evidence rather than from an empty
 * failure list: an empty reader-failure list would not notice a phase whose
 * readers never started, and the pass's rate-limit flag merges readers, judges
 * and the documentation checker, so it would reject good reading when only a
 * judge failed.
 */
const isScopeComplete = ({
	phases,
	phasesRequired,
	phasesChecked,
	phasesLight,
	gaps,
	documentationComplete,
}: {
	phases?: string[];
	phasesRequired: string[];
	phasesChecked: string[];
	phasesLight: string[];
	gaps: GradedGap[];
	documentationComplete: boolean;
}) =>
	// A human's `--phase` narrowing speaks for the files they chose, never for the ones they left out.
	phases === undefined &&
	// A pass that offered no plan file at all established nothing. A light file counts: it is an exemption the weighing made, not an unread file.
	(phasesRequired.length > 0 || phasesLight.length > 0) &&
	// `phasesChecked` names a file only when EVERY lens returned for it.
	phasesRequired.every((phase) => phasesChecked.includes(phase)) &&
	// No memory record carries an unjudged question, so only reading its plan file again can — and a baseline is a request not to.
	gaps.every(({ outcome }) => outcome !== GapOutcome.Unjudged) &&
	documentationComplete;

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
 * list when this pass owed any plan file a reader, and empty otherwise — every
 * file weighed light, the structural preflight stopped the pass before any
 * spawn, or a focused pass whose edited closure was empty. A grade whose
 * `lenses` is empty then reads as "no reader ran", never as "every lens ran and
 * found nothing".
 *
 * A focused pass is incomplete by construction, in the one spelling this report
 * already has for a partial record: it never offered every plan file to the
 * readers, so it is not a clean bill whatever it found, and it can never be the
 * pass that approves a plan. It may still be `scopeComplete` — every check its
 * own scope called for finished — which is what lets it become the baseline the
 * next repair narrows against without approving anything.
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
	scope = GradeScope.Full,
	focusedOn = [],
	inputs,
	scopeReason,
	phasesRequired,
	documentationComplete,
}: Params): GradeReport => {
	const narrowed = phases === undefined ? [] : [`graded a subset on request: ${phases.join(', ')} — the structural findings still cover every plan file`];
	const read = focusedOn.length > 0 ? focusedOn.join(', ') : 'no phase — nothing was edited';
	const focused = scope === GradeScope.Focused ? [`focused review of ${read} — a full review is required for approval`] : [];
	const reasons = [...narrowed, ...focused, ...failures];
	const complete = reasons.length === 0;
	const grade =
		complete && getBlockingFindings({ findings: structural }).length === 0 && getBlockingGaps({ gaps }).length === 0 ? PlanGrade.A : PlanGrade.BelowA;

	return {
		planName: name,
		grade,
		structural,
		gaps,
		phasesChecked,
		// From what was owed, not from `phasesChecked`: a reader that failed also
		// leaves `phasesChecked` empty, and that pass did spawn its lenses.
		lenses: phasesRequired.length === 0 ? [] : gapCheckLenses,
		weights,
		phasesLight,
		complete,
		scopeComplete: isScopeComplete({ phases, phasesRequired, phasesChecked, phasesLight, gaps, documentationComplete }),
		incompleteReason: complete ? undefined : reasons.join('; '),
		passed: grade === PlanGrade.A,
		gradedAt: new Date().toISOString(),
		gradedCommit: commit,
		gradedTreeDirty: treeDirty,
		scope,
		focusedOn,
		inputs,
		scopeReason,
	};
};
