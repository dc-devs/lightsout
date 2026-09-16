import { type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/index.ts';

/** The controlled architect explicitly classifies every imported original, including constraints carried only by the ticket. */
export const planningImportedResponse = ({ response, snapshot }: { response: PlanningRoleResult; snapshot: PlanningSnapshot }): PlanningRoleResult => {
	if (response.role !== PlanningVocabulary.Role.Architect || response.kind !== PlanningVocabulary.ResultKind.Terminal) return response;
	const sources = snapshot.record.sources.filter(
		(source) => !snapshot.record.claims.some((claim) => claim.origin.artifact === source.artifact && claim.origin.sha256 === source.sha256),
	);
	const claims = sources.map((origin, index) => ({
		id: !snapshot.record.claims.some((claim) => claim.id === 'required') && index === 0 ? 'required' : `imported:${origin.sha256}`,
		kind: PlanningVocabulary.ClaimKind.Constraint,
		text: origin.text,
		explanation: 'Preserve the complete imported retry constraint.',
		contentRevision: 1,
		origin,
		owner: PlanningVocabulary.Owner.Planner,
		state: PlanningVocabulary.ClaimState.Settled,
		dependencies: [],
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
	}));
	return {
		...response,
		claims: [
			...response.claims.map((claim) =>
				claim.kind === PlanningVocabulary.ClaimKind.Acceptance ? { ...claim, dependencies: [...claim.dependencies, ...claims.map((item) => item.id)] } : claim,
			),
			...claims,
		],
		artifactLayouts: response.artifactLayouts?.map((layout) => ({ ...layout, claimIds: [...layout.claimIds, ...claims.map((claim) => claim.id)] })),
	};
};
