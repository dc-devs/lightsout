import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { planningAlignmentBasis } from '#src/plan/workflow/common/review/planningAlignmentBasis.ts';
import { planningReviewObligations } from '#src/plan/workflow/common/review/planningReviewObligations.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Resolve the same exact notes-bound foreground approval for readiness, completion and publication. */
export const resolvePlanningAlignment = ({ snapshot }: Params): { confirmationId: string; challengeReceiptId: string; sourceDigest: string } | undefined => {
	const basis = planningAlignmentBasis({ snapshot });
	const obligations = planningReviewObligations({ snapshot, stage: PlanningVocabulary.Stage.Brainstorm });
	const confirmation = [...snapshot.record.confirmations]
		.reverse()
		.find(
			(confirmation) =>
				confirmation.alignment?.sourceDigest === basis.sourceDigest &&
				confirmation.alignment.semanticDigest === basis.semanticDigest &&
				confirmation.approvedDigest === sha256({ content: confirmation.messageText }) &&
				obligations.receipts.some(
					(receipt) =>
						receipt.id === confirmation.alignment?.challengeReceiptId &&
						receipt.role === PlanningVocabulary.Role.DesignReview &&
						snapshot.record.work.find((work) => work.id === receipt.workId)?.scope.kind === PlanningVocabulary.Scope.WholePlan &&
						obligations.sourceDigests.every((digest) => receipt.coverage.sourceDigests?.includes(digest)) &&
						obligations.claims.every((claim) => receipt.coverage.claimIds.includes(claim.id)),
				),
		);
	return confirmation?.alignment
		? { confirmationId: confirmation.id, challengeReceiptId: confirmation.alignment.challengeReceiptId, sourceDigest: basis.sourceDigest }
		: undefined;
};
