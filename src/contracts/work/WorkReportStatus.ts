export const WorkReportStatus = {
	Complete: 'complete',
	Failed: 'failed',
	/** Task is ambiguous or underspecified — the agent must not guess; the engine escalates. */
	TerminatedAmbiguity: 'terminated:ambiguity',
	/** Task references files/modules that do not exist on disk. */
	TerminatedStaleReferences: 'terminated:stale-references',
	/** Task exceeds the single-run scope guardrail and must be split. */
	TerminatedScope: 'terminated:scope',
} as const;

export type WorkReportStatus = (typeof WorkReportStatus)[keyof typeof WorkReportStatus];
