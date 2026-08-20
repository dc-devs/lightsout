/** What a run's recorded plan path turned out to hold. */
export const PlanDocumentKind = {
	Markdown: 'markdown',
	Worklist: 'worklist',
	CoverageWorklist: 'coverageWorklist',
	/** The path names nothing readable — a plan deleted after its run is a normal state, not an error. */
	Missing: 'missing',
} as const;

export type PlanDocumentKind = (typeof PlanDocumentKind)[keyof typeof PlanDocumentKind];
