import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';

interface Params {
	/** How many implementable phases the plan has. */
	phaseCount: number;
	/** The finding label — the overview's basename. */
	overviewBase: string;
}

/**
 * PhaseCount — an advisory note above eight phases.
 *
 * Its `issue` states two counted facts and predicts nothing: the phase count,
 * and `phaseCount * 3` as the number of gap-check agents one grading pass will
 * run (three lenses per phase). Its `fix` says the plan is legal and names the
 * cost in the currency that actually bites — that every one of those checkers
 * can raise gaps the human must decide, in a single sitting. A predicted gap
 * total would be a number the engine cannot know, invented in a user-facing
 * message.
 *
 * Deliberately not a ceiling: splitting one plan into several does not remove
 * cross-phase dependencies, it moves them across a boundary where there is no
 * overview and no check at all — trading a checkable edge for an unchecked one.
 * Phase size is the thing that is capped.
 */
export const checkPhaseCount = ({ phaseCount, overviewBase }: Params): StructuralFinding[] => {
	const softThreshold = 8;

	if (phaseCount <= softThreshold) {
		return [];
	}

	return [
		{
			check: StructuralCheck.PhaseCount,
			severity: FindingSeverity.Advisory,
			phase: overviewBase,
			issue: `this plan has ${phaseCount} phases, so one grading pass runs ${phaseCount * 3} gap-check agents — three lenses per phase`,
			location: `${overviewBase} → Phases`,
			fix: `legal, and no phase count is refused — but every one of those ${phaseCount * 3} checkers can raise gaps you have to decide in one sitting`,
		},
	];
};
