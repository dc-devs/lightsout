import { z } from 'zod';
import { WorkReportStatus } from './WorkReportStatus';

/**
 * The shared output contract for working agent roles (feature-executor,
 * unit-test-writer, refactor-executor). The agent's final message must be
 * exactly this shape as JSON — the engine validates it at the boundary and
 * retries on mismatch. No prose parsing, ever.
 */
export const WorkReport = z.object({
	status: z.enum(WorkReportStatus),
	/** Every source file created or modified, with a one-clause description. */
	changedFiles: z.array(
		z.object({
			path: z.string(),
			summary: z.string(),
		}),
	),
	/** One-line description of what was done (or why it wasn't). */
	summary: z.string(),
	/** Discrepancies, ambiguities, or errors — required non-empty for any non-complete status. */
	failures: z.array(z.string()),
});

export type WorkReport = z.infer<typeof WorkReport>;
