/** Semantic effects of one accepted proposal, excluding lease, receipt and transcript bookkeeping. */
export interface PlanningSemanticDelta {
	sourceChanged: boolean;
	claimIds: string[];
	evidenceIds: string[];
	artifactPaths: string[];
	boundaryPaths: string[];
	findingIds: string[];
	reviewReceiptIds: string[];
	authorWorkId: string;
}
