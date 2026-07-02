export const ImplementReportStatus = {
	Complete: 'complete',
	Failed: 'failed',
	/** Plan is ambiguous or underspecified — the agent must not guess; the engine escalates. */
	TerminatedAmbiguity: 'terminated:ambiguity',
	/** Plan references files/modules that do not exist on disk. */
	TerminatedStaleReferences: 'terminated:stale-references',
	/** Plan exceeds the single-run scope guardrail and must be split. */
	TerminatedScope: 'terminated:scope',
} as const;

export type ImplementReportStatus = (typeof ImplementReportStatus)[keyof typeof ImplementReportStatus];
