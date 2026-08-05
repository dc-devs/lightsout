import { z } from 'zod';
import { ScanFinding } from '@/contracts/scan/ScanFinding';

/**
 * One refactor-run batch: one kind of finding in one area of the repo — a
 * single agent job. Frozen into the run's worklist at start; the batch's
 * cluster ids are what the post-batch re-scan checks for resolution.
 */
export const RefactorBatch = z.object({
	/** Manifest step id: `batch-NN:<detector>:<folder>`. */
	id: z.string(),
	detector: z.string(),
	/** Grouping folder: `<packagesDir>/<package>` when under it, else the top path segment, else '(root)'. */
	folder: z.string(),
	/** Finding-severity work — must-address, re-checked after the agent reports. */
	findings: z.array(ScanFinding),
	/** Judgment-carrying advisories whose files overlap this batch — context, never blocking. */
	advisories: z.array(ScanFinding),
});

export type RefactorBatch = z.infer<typeof RefactorBatch>;
