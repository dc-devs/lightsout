import { type PlanningClaim, type PlanningRecord, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { planningScopesIntersect } from '#src/plan/workflow/common/utils/planningScopesIntersect.ts';

interface Params {
	record: PlanningRecord;
	work: Pick<PlanningWork, 'scope'>;
}

/** Select original obligations and their complete semantic/authority ancestry without truncating them. */
export const selectPlanningClaims = ({ record, work }: Params): PlanningClaim[] => {
	const selected = new Map<string, PlanningClaim>();
	const claims = new Map(record.claims.map((claim) => [claim.id, claim]));
	const include = ({ claim }: { claim: PlanningClaim }): void => {
		if (selected.has(claim.id)) return;
		selected.set(claim.id, claim);
		for (const id of [...claim.dependencies, ...(claim.supersedes === undefined ? [] : [claim.supersedes])]) {
			const required = claims.get(id);
			if (required !== undefined) include({ claim: required });
			else if (!record.evidence.some((evidence) => evidence.id === id || evidence.dependencies.some((dependency) => dependency.id === id)))
				throw new Error(`Planning context requires unresolved dependency ${id}`);
		}
	};
	for (const claim of record.claims) {
		if (
			claim.state !== PlanningVocabulary.ClaimState.Superseded &&
			(work.scope.claimIds.includes(claim.id) ||
				planningScopesIntersect({ left: work.scope, right: claim.scope }) ||
				claim.kind === PlanningVocabulary.ClaimKind.Architecture ||
				claim.kind === PlanningVocabulary.ClaimKind.Constraint)
		)
			include({ claim });
	}
	return [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
};
