import type { AdvisoryOutcome, BatchOutcome, BatchReport } from '#src/contracts/index.ts';
import type { BatchStop } from '#src/refactor/common/types/BatchStop.ts';

/**
 * What a batch accumulates about itself while it works, and the two ways it
 * hands that back: a report without ending, and a report that ends it.
 *
 * The three stores are part of the surface rather than hidden behind it
 * because the invocation path writes to them while the reporting side reads
 * them — one owner, so the account a batch gives of itself cannot disagree
 * with the account its invocations left.
 */
export interface BatchRecorder {
	/** What the passes have recorded about their own decisions, in order. */
	rationale: string[];
	/** Every path a batch's agents reported naming, fix invocations included. */
	reportedFiles: Set<string>;
	/** Each advisory's fate, keyed by site, as the agent shown it reported. */
	advisoryOutcomes: Map<string, AdvisoryOutcome>;
	/** The batch's report as it stands, without ending the batch. */
	reportOf: (params: { outcome: BatchOutcome; remainingSiteKeys: string[] }) => BatchReport;
	/** Agents' reports unioned with git truth — what the batch has actually written so far. */
	changedFiles: () => Promise<string[]>;
	/** End the batch, merging git truth into the files it claims. */
	finish: (params: { outcome: BatchOutcome; remainingSiteKeys: string[] }) => Promise<BatchStop>;
}
