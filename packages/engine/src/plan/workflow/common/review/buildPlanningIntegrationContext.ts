import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/common/review/planningIntegrationBasis.ts';
import type { PlanningIntegrationContext } from '#src/plan/workflow/common/types/PlanningIntegrationContext.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Supply real independent review proofs alongside the packet's already included originals, standards and artifacts. */
export const buildPlanningIntegrationContext = ({ snapshot }: Params): PlanningIntegrationContext => {
	const reviews = getCurrentPlanningReviews({ snapshot, stage: PlanningVocabulary.Stage.Implementation }).filter(
		(receipt) => receipt.role !== PlanningVocabulary.Role.IntegrationReview,
	);
	return {
		digest: planningIntegrationBasis({ snapshot }),
		content: canonicalJson({
			value: {
				reviews: reviews.map((receipt) => ({ receipt, acceptedResultId: snapshot.record.work.find((work) => work.id === receipt.workId)?.resultReceiptId })),
			},
		}),
		dependencies: [],
	};
};
