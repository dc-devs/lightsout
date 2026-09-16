/** Current-entry evidence about unknown reach; historical receipts alone never imply fresh assurance. */
export interface PlanningAssuranceContext {
	cycleId: string;
	basis?: string;
	/** Semantic snapshot assessed in this current engine cycle. */
	semanticDigest?: string;
	unknownDependencyIds: string[];
	pendingWorkIds: string[];
	blockedReasons: string[];
}
