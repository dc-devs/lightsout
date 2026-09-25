import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import { getDecisionReach } from '#src/plan/common/scope/getDecisionReach.ts';
import { getEditedPhases } from '#src/plan/common/scope/getEditedPhases.ts';

interface Params {
	/** This pass's fingerprint. */
	inputs: GradeInputs;
	/** The baseline fingerprint — the memory's `lastPass.inputs`; absent when no pass is on record. */
	previous?: GradeInputs;
	/** Overview text for a phased plan; absent for a single plan. */
	overviewText?: string;
	/** Every plan-file basename the deliverable holds now. */
	phaseFiles: string[];
}

/**
 * The plan files a pass must place as lost before any closure is walked: the
 * edited plan files, plus — for a phased plan — the phases the changed decision
 * rows name, or the reason that reach cannot be placed.
 *
 * A pass with no baseline has read nothing, so every plan file is a seed rather
 * than none. A single plan has no Decision Log part to compare and keeps its
 * edited files alone.
 *
 * It is its own function because two callers need the same answer and neither
 * may compute its own: the scope decision reads it to bound what this pass
 * reads, and the pass reads it to bound which open findings are re-verified —
 * which happens on a full pass too, where there is no scope decision to take
 * seeds from. A second copy of the derivation is two reach rules that can
 * disagree, which is the defect one reach rule exists to avoid.
 *
 * @returns the seeds, or an error the caller turns into a full review
 */
export const getCoverageSeeds = ({ inputs, previous, overviewText, phaseFiles }: Params): { seeds: string[] } | { error: string } => {
	if (previous === undefined) {
		return { seeds: phaseFiles };
	}

	const { edited, overviewFileChanged } = getEditedPhases({ current: inputs, previous });

	if (overviewText === undefined) {
		return { seeds: edited };
	}

	const reach = getDecisionReach({ current: inputs.decisionLog, previous: previous.decisionLog, overviewFileChanged, edited, phaseFiles });

	return 'error' in reach ? { error: reach.error } : { seeds: [...edited, ...reach.phases] };
};
