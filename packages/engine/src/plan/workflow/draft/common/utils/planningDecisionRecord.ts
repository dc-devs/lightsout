import { DecisionSource, type DecisionsRecord, type PlanningClaim, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Project canonical decisions for the existing deterministic log and lint, without inventing dialogue or confirmation provenance. */
export const planningDecisionRecord = ({ snapshot }: Params): DecisionsRecord => {
	const record = snapshot.record;
	const rootOf = ({ claim }: { claim: PlanningClaim }): PlanningClaim => {
		const visited = new Set<string>();
		let root = claim;
		while (root.supersedes !== undefined) {
			if (visited.has(root.id)) throw new Error(`Cyclic decision history: ${root.id}`);
			visited.add(root.id);
			const previous = record.claims.find((item) => item.id === root.supersedes);
			if (!previous) throw new Error(`Missing decision predecessor: ${root.supersedes}`);
			root = previous;
		}
		return root;
	};
	return {
		planName: record.planName,
		decisions: record.claims
			.filter((claim) => claim.kind === PlanningVocabulary.ClaimKind.Decision || claim.kind === PlanningVocabulary.ClaimKind.Constraint)
			.map((claim) => {
				const root = rootOf({ claim });
				const phases = claim.scope.phaseIds.map((id) => {
					const phase = record.artifacts.find((artifact) => artifact.phaseId === id);
					if (!phase) throw new Error(`Missing decision phase: ${id}`);
					return phase.path;
				});
				const qualification =
					claim.scope.kind === PlanningVocabulary.Scope.WholePlan
						? ''
						: `[Applies to phases ${phases.join(', ') || 'as assigned'}, roots ${claim.scope.packageRoots.join(', ') || 'as assigned'}] `;
				return {
					source: DecisionSource.Planning,
					question: `${claim.kind === PlanningVocabulary.ClaimKind.Constraint ? 'Global constraint: ' : ''}${root.id}: ${root.origin.locator}`,
					options: 'Options are not encoded in this claim; inspect its captured source and related question.',
					choice: `${claim.kind === PlanningVocabulary.ClaimKind.Constraint ? qualification : ''}${claim.text}`,
					rationale: `${claim.explanation} [Claim ${claim.id}; source ${claim.origin.artifact} at ${claim.origin.locator}; ${claim.confirmationId ? `confirmation ${claim.confirmationId}` : claim.legacySettlementId ? `historical settlement ${claim.legacySettlementId}` : `owner ${claim.owner}`}].`,
					assumption: claim.state === PlanningVocabulary.ClaimState.Unresolved,
					...(phases.length > 0 ? { phases } : {}),
				};
			}),
	};
};
