import { z } from 'zod';
import { CoverageFile } from '#src/contracts/coverage/CoverageFile.ts';
import { CoverageTotal } from '#src/contracts/coverage/CoverageTotal.ts';

/**
 * A coverage run's initial measurement, frozen into the run dir at run start.
 * It is the `before` side of the final report and the manifest's `plan`
 * pointer — never the source of later batches, because writing tests changes
 * the very numbers a work-list would be built from. Every round measures
 * again.
 */
export const CoverageWorklist = z.object({
	at: z.string(),
	totals: z.array(CoverageTotal),
	/** Worst-first (statements pct ascending, ties by path). */
	files: z.array(CoverageFile),
});

export type CoverageWorklist = z.infer<typeof CoverageWorklist>;
