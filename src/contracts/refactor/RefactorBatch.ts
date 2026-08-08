import { z } from 'zod';
import { StandardsFinding } from '@/contracts/standardsCheck';

/**
 * One refactor-run batch: one kind of finding in one area of the repo — a
 * single agent job. Frozen into the run's worklist at start; the batch's
 * site keys are what the post-batch re-check looks for.
 */
export const RefactorBatch = z.object({
	/** Manifest step id: `batch-NN:<rule>:<folder>` — the rule is one of the standards-check rule ids, not a check function. */
	id: z.string(),
	rule: z.string(),
	/** Grouping folder: `<packagesDir>/<package>` when under it, else the top path segment, else '(root)'. */
	folder: z.string(),
	/** Blocking-severity work — must-address, re-checked after the agent reports. */
	blocking: z.array(StandardsFinding),
	/** Judgment-carrying advisories whose files overlap this batch — context, never blocking. */
	advisories: z.array(StandardsFinding),
});

export type RefactorBatch = z.infer<typeof RefactorBatch>;
