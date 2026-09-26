/** How a batch's verify came to rest — the discriminant of {@link SettleOutcome}. */
export const SettleKind = {
	/** The gates are green: the batch may be classified on its findings. */
	Green: 'green',
	/** Hit the harness rate-limit wall — resumable, not an error. */
	Parked: 'parked',
	/** A human decision is required before this batch can go further. */
	Escalated: 'escalated',
} as const;

export type SettleKind = (typeof SettleKind)[keyof typeof SettleKind];
