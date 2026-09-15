import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningFinding, type PlanningReviewReceipt, PlanningVocabulary } from '#src/contracts/index.ts';
import { PlanningInvocation } from '#src/plan/workflow/common/types/PlanningInvocation.ts';
import { PlanningSettlement } from '#src/plan/workflow/common/types/PlanningSettlement.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { PlanningResultReceipt, planningResultReceiptPath } from '#src/plan/workflow/store/index.ts';

interface Params {
	snapshot: PlanningSnapshot;
	finding: PlanningFinding;
	reviews: PlanningReviewReceipt[];
}

const withdrawalAccepted = ({ snapshot, finding }: { snapshot: PlanningSnapshot; finding: PlanningFinding }) => {
	let settled = false;
	for (const citation of finding.citations) {
		if (!citation.artifact.startsWith('planning-results/')) continue;
		const result = readPlanningProof({ snapshot, path: citation.artifact, schema: PlanningResultReceipt });
		if (
			result &&
			result.acceptedRevision <= snapshot.record.revision &&
			citation.sha256 === snapshot.record.artifacts.find((artifact) => artifact.path === citation.artifact)?.sha256 &&
			citation.quote === result.attemptId &&
			snapshot.record.work.some((work) => work.id === result.workId && work.failureIds.includes(finding.id))
		) {
			settled = true;
			break;
		}
	}
	if (!settled)
		for (const descriptor of snapshot.record.artifacts.filter((artifact) => artifact.path.startsWith('planning-settlements/'))) {
			const settlement = readPlanningProof({ snapshot, path: descriptor.path, schema: PlanningSettlement });
			if (
				!settlement ||
				settlement.findingId !== finding.id ||
				settlement.reason !== finding.proposedResolution ||
				descriptor.path !== `planning-settlements/${sha256({ content: `${settlement.attemptId}:${settlement.findingId}` })}.json`
			)
				continue;
			const result = readPlanningProof({ snapshot, path: planningResultReceiptPath({ id: settlement.resultReceiptId }), schema: PlanningResultReceipt });
			const invocation = readPlanningProof({
				snapshot,
				path: `planning-invocations/${sha256({ content: settlement.invocationId })}.json`,
				schema: PlanningInvocation,
			});
			if (
				!result ||
				!invocation ||
				result.workId !== settlement.workId ||
				result.attemptId !== settlement.attemptId ||
				result.role !== PlanningVocabulary.Role.Adjudicate ||
				result.acceptedRevision <= 0 ||
				result.acceptedRevision > snapshot.record.revision ||
				invocation.id !== settlement.invocationId ||
				invocation.workId !== result.workId ||
				invocation.attemptId !== result.attemptId ||
				invocation.role !== result.role ||
				invocation.inputDigest !== result.inputDigest ||
				canonicalJson({ value: invocation.dependencies }) !== canonicalJson({ value: settlement.dependencies })
			)
				continue;
			if (
				settlement.citations.every((citation) => {
					const content = snapshot.artifacts.get(citation.artifact);
					return content === undefined
						? settlement.dependencies.some(
								(dependency) =>
									dependency.kind === PlanningVocabulary.Dependency.Content && dependency.path === citation.artifact && dependency.sha256 === citation.sha256,
							)
						: sha256({ content }) === citation.sha256 && content.includes(citation.quote);
				})
			) {
				settled = true;
				break;
			}
		}
	return settled;
};

/** A finding remains unresolved unless current independent verification or accepted evidenced withdrawal supports it. */
export const planningFindingSettlement = ({ snapshot, finding, reviews }: Params): boolean => {
	const implementation = snapshot.record.reviewReceipts.some(
		(receipt) =>
			receipt.findingIds.includes(finding.id) &&
			(receipt.role === PlanningVocabulary.Role.ImplementationReview || receipt.role === PlanningVocabulary.Role.IntegrationReview),
	);
	let settled = false;
	if (finding.state === PlanningVocabulary.FindingState.Verified)
		settled = reviews.some(
			(receipt) =>
				(!implementation || receipt.role === PlanningVocabulary.Role.ImplementationReview || receipt.role === PlanningVocabulary.Role.IntegrationReview) &&
				finding.verificationReceiptIds.includes(receipt.id) &&
				receipt.coverage.outcome === PlanningVocabulary.Review.Adequate &&
				receipt.verifiedFindings.some((verification) => verification.findingId === finding.id && verification.citations.length > 0),
		);
	if (finding.state === PlanningVocabulary.FindingState.Withdrawn) settled = withdrawalAccepted({ snapshot, finding });
	return settled;
};
