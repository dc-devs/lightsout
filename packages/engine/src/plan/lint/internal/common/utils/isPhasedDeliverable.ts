interface Params {
	/** Whether the deliverable resolved an `overview.md`. */
	hasOverview: boolean;
	/** How many implementable plan files it resolved — the overview excluded. */
	implementableCount: number;
}

/**
 * Whether a resolved deliverable is phased: an overview is present, or more than
 * one implementable plan file is.
 *
 * Spelled once because two passes decide it — the deterministic lint over the
 * files it read itself, and the dedup precheck over the files the detection pass
 * handed it — and `checkDecisionLog` asks a phase file for a different section
 * than a single plan. Two copies drifting means one plan file could pass one
 * pass and fail the other on the same bytes.
 */
export const isPhasedDeliverable = ({ hasOverview, implementableCount }: Params): boolean => hasOverview || implementableCount > 1;
