import { z } from 'zod';
import { StandardsFinding } from '#src/contracts/standardsCheck/StandardsFinding.ts';

/**
 * One persisted standards-check result — the shape of
 * `.lightsout/standards-check.json` and of every dated copy beside it.
 *
 * Declaring it is what lets a reader validate a snapshot at the boundary
 * instead of trusting a file that may have been written by an older engine, or
 * hand-edited. Key order is load-bearing: the refactor pipeline reads the
 * latest file as its work-list, and people read it in diffs.
 */
export const StandardsSnapshot = z.object({
	at: z.string(),
	/** Repo-relative subpath the check covered ('.' for the whole repo). */
	path: z.string(),
	findings: z.array(StandardsFinding),
	notes: z.array(z.string()),
});

export type StandardsSnapshot = z.infer<typeof StandardsSnapshot>;
