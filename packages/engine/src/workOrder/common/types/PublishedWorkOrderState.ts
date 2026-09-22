import type { WorkOrderState } from '#src/contracts/index.ts';

/** The work order state as the tracker carries it, paired with the bytes every hash comparison is made against. */
export interface PublishedWorkOrderState {
	record: WorkOrderState;
	/** The record's normalised bytes — never the text as it was attached, so equal content always hashes equally. */
	content: Buffer;
}
