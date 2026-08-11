/**
 * One group of files routed to a human rather than to another writer: a
 * declined batch's tracked files, or a single file that kept riding along in
 * improving batches without improving itself.
 */
export interface CoverageSetAside {
	/** The batch whose report produced this entry. */
	batchId: string;
	files: string[];
	/** Why these files stopped — the agent's own lines where there are any. */
	rationale: string[];
}
