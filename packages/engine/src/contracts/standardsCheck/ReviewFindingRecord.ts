import { z } from 'zod';
import { StandardsFinding } from '#src/contracts/standardsCheck/StandardsFinding.ts';

/**
 * A judgment finding as persisted to `.lightsout/review-findings.jsonl` — the
 * finding plus provenance (which run, which batch, when). One JSON line per
 * record.
 *
 * Written the moment an agent review reports it, before anything is spent
 * trying to act on it. A run that parks on a rate limit or escalates never
 * builds its batch report, so without this the only account of what the review
 * saw dies with the process — and a judgment finding has no second witness the
 * way a checked one does, because no code check can rediscover it.
 *
 * What was DONE about a finding is not here: the batch report's
 * `advisoryOutcomes` already answers that, keyed by the same site. Two records
 * of one answer is how the two come to disagree.
 */
export const ReviewFindingRecord = StandardsFinding.extend({
	at: z.string(),
	runId: z.string(),
	/** The batch that was working when the review ran. */
	step: z.string(),
});

export type ReviewFindingRecord = z.infer<typeof ReviewFindingRecord>;
