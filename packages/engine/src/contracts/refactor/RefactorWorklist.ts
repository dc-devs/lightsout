import { z } from 'zod';
import { RefactorBatch } from '@/contracts/refactor/RefactorBatch';

/**
 * A refactor run's frozen work-list: computed from the tree once at run
 * start, persisted to the run dir, and never recomputed mid-run — resume is
 * deterministic because the manifest's `plan` points here. A fresh run checks
 * fresh.
 */
export const RefactorWorklist = z.object({
	at: z.string(),
	/** Standards-check scope subpath, '.' for the whole repo. */
	path: z.string(),
	/** Whether baselined findings were included (burn-down mode). */
	all: z.boolean(),
	batches: z.array(RefactorBatch),
});

export type RefactorWorklist = z.infer<typeof RefactorWorklist>;
