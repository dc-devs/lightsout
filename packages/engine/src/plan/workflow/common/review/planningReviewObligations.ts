import { PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/common/review/planningIntegrationBasis.ts';
import type { PlanningReviewObligations } from '#src/plan/workflow/common/review/types/PlanningReviewObligations.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	stage: PlanningWork['stage'];
}

/** Semantic obligations require actual adequate coverage, regardless of file counts or who can resolve a defect. */
export const planningReviewObligations = ({ snapshot, stage }: Params): PlanningReviewObligations => {
	const record = snapshot.record;
	const claims = record.claims.filter(
		(claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded && claim.kind !== PlanningVocabulary.ClaimKind.Question,
	);
	const artifacts = record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data);
	const sourceDigests = [...new Set(record.sources.map((source) => source.sha256))].sort();
	const receipts = getCurrentPlanningReviews({ snapshot, stage }).filter((receipt) => receipt.coverage.outcome === PlanningVocabulary.Review.Adequate);
	const role = stage === PlanningVocabulary.Stage.Brainstorm ? PlanningVocabulary.Role.DesignReview : PlanningVocabulary.Role.ImplementationReview;
	const detailed = receipts.filter((receipt) => receipt.role === role);
	const design = receipts.filter((receipt) => receipt.role === PlanningVocabulary.Role.DesignReview);
	const fullSources = design.find((receipt) => {
		const work = record.work.find((work) => work.id === receipt.workId);
		return (
			work?.scope.kind === PlanningVocabulary.Scope.WholePlan &&
			sourceDigests.every((digest) => receipt.coverage.sourceDigests?.includes(digest)) &&
			(stage !== PlanningVocabulary.Stage.Brainstorm || claims.every((claim) => receipt.coverage.claimIds.includes(claim.id)))
		);
	});
	const uncoveredClaimIds = claims.filter((claim) => !detailed.some((receipt) => receipt.coverage.claimIds.includes(claim.id))).map((claim) => claim.id);
	const uncoveredPaths =
		stage === PlanningVocabulary.Stage.Brainstorm
			? []
			: artifacts
					.filter(
						(artifact) =>
							!detailed.some(
								(receipt) =>
									receipt.coverage.artifactPaths?.includes(artifact.path) && (!artifact.phaseId || receipt.coverage.phaseIds.includes(artifact.phaseId)),
							),
					)
					.map((artifact) => artifact.path);
	const integration = receipts.find(
		(receipt) =>
			receipt.role === PlanningVocabulary.Role.IntegrationReview &&
			receipt.integrationDigest === planningIntegrationBasis({ snapshot }) &&
			record.work.find((work) => work.id === receipt.workId)?.scope.kind === PlanningVocabulary.Scope.WholePlan &&
			sourceDigests.every((digest) => receipt.coverage.sourceDigests?.includes(digest)) &&
			claims.every((claim) => receipt.coverage.claimIds.includes(claim.id)) &&
			artifacts.every(
				(artifact) => receipt.coverage.artifactPaths?.includes(artifact.path) && (!artifact.phaseId || receipt.coverage.phaseIds.includes(artifact.phaseId)),
			),
	);
	return { integration, claims, artifacts, sourceDigests, receipts, detailed, fullSources, uncoveredClaimIds, uncoveredPaths, role };
};
