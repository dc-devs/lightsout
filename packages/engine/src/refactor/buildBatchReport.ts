import type { AdvisoryOutcome, BatchOutcome, BatchReport } from '#src/contracts/index.ts';

interface Params {
	outcome: BatchOutcome;
	/** Site keys still present after the batch (empty when resolved). */
	remainingSiteKeys: string[];
	/** Why findings were declined, accumulated across the batch's invocations. */
	rationale: string[];
	/** What the agent did about each advisory it was shown, last answer per site. */
	advisoryOutcomes: AdvisoryOutcome[];
}

/**
 * A batch's terminal report, assembled in one place so no exit can quietly drop
 * one of the two accounts a batch keeps.
 *
 * An empty advisory account is omitted rather than written as an empty list: a
 * batch that was shown no advice and one whose agent said nothing about it are
 * the same absence, and it is the same absence a manifest written before the
 * field existed carries.
 */
export const buildBatchReport = ({ outcome, remainingSiteKeys, rationale, advisoryOutcomes }: Params): BatchReport => {
	return { outcome, remainingSiteKeys, rationale, ...(advisoryOutcomes.length > 0 ? { advisoryOutcomes } : {}) };
};
