import { z } from 'zod';
import { ImplementReportStatus } from './ImplementReportStatus';

/**
 * The feature-executor's output contract. The agent's final message must be
 * exactly this shape as JSON — the engine validates it at the boundary and
 * retries on mismatch. No prose parsing, ever.
 */
export const ImplementReport = z.object({
	status: z.enum(ImplementReportStatus),
	/** Every source file created or modified, with a one-clause description. */
	changedFiles: z.array(
		z.object({
			path: z.string(),
			summary: z.string(),
		}),
	),
	/** One-line description of what was implemented (or why it wasn't). */
	summary: z.string(),
	/** Discrepancies, ambiguities, or errors — required non-empty for any non-complete status. */
	failures: z.array(z.string()),
});

export type ImplementReport = z.infer<typeof ImplementReport>;
