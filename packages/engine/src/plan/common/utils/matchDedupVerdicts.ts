import type { DedupFinding, DedupVerdict } from '#src/contracts/index.ts';
import type { PriorArtCandidate } from '#src/plan/common/types/PriorArtCandidate.ts';

interface Params {
	/** Every name collision the engine detected, deterministically. */
	candidates: PriorArtCandidate[];
	/** The judge agent's rulings, in whatever order and completeness it returned them. */
	verdicts: DedupVerdict[];
}

/**
 * Join what the engine detected with what the judge ruled, keeping only the
 * collisions confirmed as real duplication.
 *
 * The two halves of a finding come from different places and neither is
 * authoritative alone: the collision and its location are detected facts, while
 * whether it matters and how to resolve it is the agent's judgment. They are
 * matched on `plannedSymbol`, and the detected candidates drive the loop — a
 * verdict about a symbol nobody detected is discarded rather than reported,
 * because a finding must carry the real `collidesWith` locations a human is
 * about to go read. An unjudged candidate is likewise dropped: silence is not
 * a confirmation.
 */
export const matchDedupVerdicts = ({ candidates, verdicts }: Params): DedupFinding[] => {
	const verdictBySymbol = new Map(verdicts.map((verdict) => [verdict.plannedSymbol, verdict]));

	return candidates.flatMap((candidate) => {
		const verdict = verdictBySymbol.get(candidate.plannedSymbol);

		if (!verdict?.isDuplicate) {
			return [];
		}

		return [
			{
				plannedSymbol: candidate.plannedSymbol,
				plannedPath: candidate.plannedPath,
				collidesWith: candidate.collidesWith,
				recommendation: verdict.recommendation,
				rationale: verdict.rationale,
				suggestedLocation: verdict.suggestedLocation,
				migrateCallers: verdict.migrateCallers,
			},
		];
	});
};
