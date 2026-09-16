import { PlanningVocabulary } from '#src/contracts/index.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import { planningAssuranceReady } from '#src/plan/workflow/common/review/planningAssuranceReady.ts';
import { planningFindingSettlement } from '#src/plan/workflow/common/review/planningFindingSettlement.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/common/review/planningIntegrationBasis.ts';
import { planningReviewObligations } from '#src/plan/workflow/common/review/planningReviewObligations.ts';
import type { PlanningAssuranceContext } from '#src/plan/workflow/common/types/PlanningAssuranceContext.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	assurance?: PlanningAssuranceContext;
}

/** Ask for proposal approval only after adequate design coverage, closed blockers and current unknown-reach assurance. */
export const planningDesignReadyForProposal = ({ snapshot, assurance }: Params): boolean => {
	const obligations = planningReviewObligations({ snapshot, stage: PlanningVocabulary.Stage.Implementation });
	const reviews = getCurrentPlanningReviews({ snapshot });
	const working = snapshot.record.work.some(
		(work) =>
			work.stage === PlanningVocabulary.Stage.Implementation &&
			work.status !== PlanningVocabulary.WorkState.Complete &&
			(work.id.startsWith('assurance:') ||
				[
					PlanningVocabulary.Role.Investigate,
					PlanningVocabulary.Role.Architect,
					PlanningVocabulary.Role.DesignReview,
					PlanningVocabulary.Role.Repair,
					PlanningVocabulary.Role.Adjudicate,
					PlanningVocabulary.Role.Diagnose,
				].some((role) => role === work.role)),
	);
	return (
		!working &&
		obligations.fullSources !== undefined &&
		obligations.claims.every(
			(claim) => claim.state === PlanningVocabulary.ClaimState.Settled && obligations.fullSources?.coverage.claimIds.includes(claim.id),
		) &&
		snapshot.record.findings.every(
			(finding) => finding.severity !== PlanningVocabulary.Severity.Blocking || planningFindingSettlement({ snapshot, finding, reviews }),
		) &&
		planningAssuranceReady({ snapshot, reviews, assurance, inputDigest: planningIntegrationBasis({ snapshot }) })
	);
};
