/** How a batch attempt came to rest — the discriminant of {@link BatchStop}. */
export const BatchStopKind = {
	Parked: 'parked',
	Failed: 'failed',
	Escalated: 'escalated',
	Done: 'done',
} as const;

export type BatchStopKind = (typeof BatchStopKind)[keyof typeof BatchStopKind];
