import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningGraphContext } from '#src/plan/workflow/store/common/types/PlanningGraphContext.ts';
import { checkPlanningCycles } from '#src/plan/workflow/store/common/validation/checkPlanningCycles.ts';
import { requirePlanningIds } from '#src/plan/workflow/store/common/validation/requirePlanningIds.ts';

/** Validate claim provenance and explicit replacements. */
export const validatePlanningClaims = ({ record, issues, ids, claims }: PlanningGraphContext): void => {
	const confirmations = new Map(record.confirmations.map((confirmation) => [confirmation.id, confirmation]));
	const supersessions = new Map<string, string[]>();
	for (const claim of record.claims) {
		const at = `claims.${claim.id}`;
		if (claim.state === PlanningVocabulary.ClaimState.Superseded && !record.claims.some((replacement) => replacement.supersedes === claim.id))
			issues.push({ at, message: 'Superseded obligation has no explicit successor' });
		if (
			claim.state !== PlanningVocabulary.ClaimState.Superseded &&
			claim.dependencies.some((id) => record.claims.some((dependency) => dependency.id === id && dependency.state === PlanningVocabulary.ClaimState.Superseded))
		)
			issues.push({ at, message: 'Active semantic dependencies must resolve to current replacements' });
		requirePlanningIds({ values: claim.dependencies, available: ids, at, issues });
		const source = record.sources.find(
			(entry) =>
				entry.artifact === claim.origin.artifact &&
				entry.locator === claim.origin.locator &&
				entry.sha256 === claim.origin.sha256 &&
				entry.text === claim.origin.text,
		);
		if (source === undefined) issues.push({ at, message: 'Claim origin does not match a captured source' });
		if (claim.supersedes !== undefined) {
			requirePlanningIds({ values: [claim.supersedes], available: claims, at, issues });
			const previous = record.claims.find((entry) => entry.id === claim.supersedes);
			if (previous?.state !== PlanningVocabulary.ClaimState.Superseded) issues.push({ at, message: 'Superseded claim must remain explicitly superseded' });
			supersessions.set(claim.id, [claim.supersedes]);
		}
		if (claim.confirmationId !== undefined) {
			if (claim.state === PlanningVocabulary.ClaimState.Unresolved || claim.legacySettlementId !== undefined)
				issues.push({ at, message: 'A confirmed claim cannot be unresolved or carry conflicting historical authority' });
			if (claim.text !== claim.origin.text) issues.push({ at, message: 'Confirmed claim must retain the exact approved source text' });
			const confirmation = confirmations.get(claim.confirmationId);
			if (confirmation === undefined || confirmation.approvedDigest !== claim.origin.sha256)
				issues.push({ at, message: 'Confirmation does not bind this original source' });
			else if (confirmation.delegation.kind === PlanningVocabulary.Scope.Selected && !confirmation.delegation.claimIds.includes(claim.id)) {
				const delegated = confirmation.delegation;
				const covered =
					claim.scope.kind === PlanningVocabulary.Scope.Selected &&
					claim.scope.claimIds.every((id) => delegated.claimIds.includes(id)) &&
					claim.scope.phaseIds.every((id) => delegated.phaseIds.includes(id)) &&
					claim.scope.packageRoots.every((root) =>
						delegated.packageRoots.some((allowed) => allowed === '.' || root === allowed || root.startsWith(`${allowed}/`)),
					);
				if (!covered) issues.push({ at, message: 'Confirmation delegation does not cover the complete claim scope' });
			}
		}
		if (claim.kind === PlanningVocabulary.ClaimKind.Question && claim.question.answerId !== undefined) {
			requirePlanningIds({ values: [claim.question.answerId], available: claims, at, issues });
			const answer = record.claims.find((item) => item.id === claim.question.answerId);
			if (
				claim.state !== PlanningVocabulary.ClaimState.Superseded ||
				answer?.supersedes !== claim.id ||
				answer.confirmationId === undefined ||
				answer.owner !== PlanningVocabulary.Owner.User
			)
				issues.push({ at, message: 'Question answer must name its explicit foreground-confirmed successor' });
		}
	}
	checkPlanningCycles({ edges: supersessions, at: 'claims.supersedes', issues });
};
