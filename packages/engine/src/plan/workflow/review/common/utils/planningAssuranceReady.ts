import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningReviewReceipt, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningAssuranceContext } from '#src/plan/workflow/common/types/PlanningAssuranceContext.ts';
import { PlanningAssuranceResult } from '#src/plan/workflow/common/types/PlanningAssuranceResult.ts';
import { PlanningInvocation } from '#src/plan/workflow/common/types/PlanningInvocation.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';

interface Params {
	snapshot: PlanningSnapshot;
	reviews: PlanningReviewReceipt[];
	assurance?: PlanningAssuranceContext;
	inputDigest: string;
}

/** Unchanged unknown reach stays unknown; only an accepted current-cycle exact-basis assessment supplies assurance. */
export const planningAssuranceReady = ({ snapshot, reviews, assurance, inputDigest }: Params): boolean => {
	if (
		snapshot.record.evidence.some(
			(evidence) =>
				evidence.complete &&
				evidence.dependencyReach === PlanningVocabulary.DependencyReach.Unknown &&
				!evidence.dependencies.some((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown),
		)
	)
		return false;
	const unknown = new Set([
		...reviews.flatMap((review) =>
			review.dependencies.filter((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown).map((dependency) => dependency.id),
		),
		...snapshot.record.evidence
			.filter((evidence) => evidence.complete)
			.flatMap((evidence) =>
				evidence.dependencies.filter((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown).map((dependency) => dependency.id),
			),
		...(assurance?.unknownDependencyIds ?? []),
	]);
	if (assurance && (assurance.blockedReasons.length > 0 || assurance.pendingWorkIds.length > 0)) return false;
	if (unknown.size === 0) return true;
	if (!assurance?.basis || assurance.semanticDigest !== inputDigest) return false;
	return snapshot.record.artifacts
		.filter((artifact) => artifact.path.startsWith('planning-assurances/'))
		.some((artifact) => {
			const report = readPlanningProof({ snapshot, path: artifact.path, schema: PlanningAssuranceResult });
			if (!report || report.basis !== assurance.basis || report.cycleId !== assurance.cycleId || report.blockedReasons.length > 0) return false;
			const receipt = reviews.find(
				(receipt) =>
					receipt.workId === report.workId && receipt.attemptId === report.attemptId && receipt.coverage.outcome === PlanningVocabulary.Review.Adequate,
			);
			if (!receipt) return false;
			const invocation = readPlanningProof({
				snapshot,
				path: `planning-invocations/${sha256({ content: receipt.issuer.invocationId })}.json`,
				schema: PlanningInvocation,
			});
			return (
				invocation?.assuranceBasis === report.basis &&
				[...unknown].every((id) =>
					report.assessments.some(
						(assessment) => assessment.dependencyIds.includes(id) && assessment.outcome !== PlanningVocabulary.UnknownAssessment.Unavailable,
					),
				) &&
				snapshot.record.claims
					.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded)
					.every((claim) => receipt.coverage.claimIds.includes(claim.id))
			);
		});
};
