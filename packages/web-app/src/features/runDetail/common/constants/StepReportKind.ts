/** What a step's opaque `report` field turned out to hold. */
export const StepReportKind = {
	/** A refactor batch's account of the sites it was given. */
	Batch: 'batch',
	/** A coordinator step's pointer at the child run that implemented the phase. */
	Phase: 'phase',
	/** The write-tests step's envelope of one report per writer batch. */
	Writers: 'writers',
	/** The shared report every working agent role emits. */
	Work: 'work',
	/** Nothing this app recognises — shown as the JSON the manifest stores. */
	Raw: 'raw',
} as const;

export type StepReportKind = (typeof StepReportKind)[keyof typeof StepReportKind];
