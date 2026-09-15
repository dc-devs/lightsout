import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	previous: PlanningRecord;
	record: PlanningRecord;
}
const redirects = ({ prior, next, record }: { prior: string; next: string; record: PlanningRecord }) => {
	const visited = new Set<string>();
	let cursor: string | undefined = next;
	while (cursor !== undefined && !visited.has(cursor)) {
		if (cursor === prior) return true;
		visited.add(cursor);
		cursor = record.claims.find((claim) => claim.id === cursor)?.supersedes;
	}
	return false;
};

/** Approved meaning remains immutable after supersession; validated dependency successors may replace engine-owned graph edges. */
export const validateApprovedPlanningClaims = ({ previous, record }: Params): void => {
	for (const original of previous.claims.filter((claim) => claim.legacySettlementId !== undefined || claim.confirmationId !== undefined)) {
		const next = record.claims.find((claim) => claim.id === original.id);
		if (next === undefined) throw new Error('Approved historical claims cannot be deleted');
		const successor = record.claims.find((claim) => claim.supersedes === original.id);
		const permittedState =
			next.state === original.state ||
			(original.state === PlanningVocabulary.ClaimState.Settled &&
				next.state === PlanningVocabulary.ClaimState.Superseded &&
				successor?.confirmationId !== undefined &&
				successor.state === PlanningVocabulary.ClaimState.Settled);
		const dependenciesMatch =
			next.dependencies.length === original.dependencies.length &&
			original.dependencies.every((prior) => next.dependencies.some((dependency) => redirects({ prior, next: dependency, record })));
		const stable = canonicalJson({ value: { ...next, state: original.state, dependencies: original.dependencies } }) === canonicalJson({ value: original });
		if (!permittedState || !dependenciesMatch || !stable) throw new Error('Approved historical claims must preserve their meaning and provenance');
	}
};
