import { z } from 'zod';
import { RunBurnDownBatch } from '#src/contracts/views/runBurnDown/RunBurnDownBatch.ts';

/**
 * What a batch-shaped run burned down — computed once, so a page never parses
 * a step report to draw a before/after.
 *
 * Present on refactor and coverage runs; absent on implement and phases runs,
 * which burn nothing down. The two pipelines fill different halves of it: a
 * refactor run counts sites, a coverage run measures files, and neither
 * borrows the other's fields.
 */
export const RunBurnDown = z.object({
	/** Refactor only: blocking findings on the work-list when it froze. Absent for coverage runs, which carry `files` instead. */
	before: z.number().optional(),
	/** Refactor only: sites still standing after the last batch — reported batches' remaining keys plus unrun batches' frozen blocking counts. */
	after: z.number().optional(),
	/** Refactor only, from each parsed BatchReport.outcome; absent for coverage runs. */
	batchesResolved: z.number().optional(),
	batchesDeclined: z.number().optional(),
	/** Refactor only: one row per batch, in work-list order. */
	batches: z.array(RunBurnDownBatch),
	/** Refactor only: findings from the size and crowding rules, before to after. */
	overCap: z.object({ before: z.number(), after: z.number() }).optional(),
	/** Coverage only: per-file statements pct, before to after, worst first. */
	files: z.array(z.object({ path: z.string(), beforePct: z.number(), afterPct: z.number() })).optional(),
});

export type RunBurnDown = z.infer<typeof RunBurnDown>;
