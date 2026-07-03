import { z } from 'zod';
import { FrictionEntry } from './FrictionEntry';
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
	/** Discrepancies, ambiguities, or errors — expected non-empty for any non-complete status. Defaulted: a complete report that omits it means "none" (observed in the wild), and the re-emit retry is too expensive for that ambiguity-free case. */
	failures: z.array(z.string()).default([]),
	/** Moments where the system fought the agent — fuel for the self-improvement loop. Omitted when clean. */
	friction: z.array(FrictionEntry).optional(),
});

export type WorkReport = z.infer<typeof WorkReport>;
