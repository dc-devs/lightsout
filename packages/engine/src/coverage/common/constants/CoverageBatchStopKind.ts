/** How a coverage batch came to rest — the discriminant of {@link CoverageBatchStop}. */
export const CoverageBatchStopKind = {
	Parked: 'parked',
	Failed: 'failed',
	Escalated: 'escalated',
	Done: 'done',
} as const;

export type CoverageBatchStopKind = (typeof CoverageBatchStopKind)[keyof typeof CoverageBatchStopKind];
