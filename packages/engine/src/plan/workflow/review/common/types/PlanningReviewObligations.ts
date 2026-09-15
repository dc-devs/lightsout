import type { PlanningArtifact, PlanningClaim, PlanningReviewReceipt, PlanningWork } from '#src/contracts/index.ts';

/** Current role coverage and the concrete obligations still requiring independent inspection. */
export interface PlanningReviewObligations {
	claims: PlanningClaim[];
	artifacts: PlanningArtifact[];
	sourceDigests: string[];
	receipts: PlanningReviewReceipt[];
	detailed: PlanningReviewReceipt[];
	fullSources?: PlanningReviewReceipt;
	integration?: PlanningReviewReceipt;
	uncoveredClaimIds: string[];
	uncoveredPaths: string[];
	role: PlanningWork['role'];
}
