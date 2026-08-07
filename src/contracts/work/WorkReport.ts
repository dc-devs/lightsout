import { z } from 'zod';
import { FrictionEntry } from '@/contracts/friction';
import { WorkReportStatus } from '@/contracts/work/WorkReportStatus';

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
	/** Prior-art evidence: for each NEW exported symbol the plan didn't explicitly name, the searches run against existing exports before creating it. "Searched, found nothing" becomes typed manifest evidence, not free text. Executor role only; other roles omit. */
	priorArt: z
		.array(
			z.object({
				/** The newly created exported symbol. */
				symbol: z.string(),
				/** Search terms/globs run against the repo before creating it. */
				searches: z.array(z.string()),
				/** Existing exports the searches surfaced (empty = nothing similar exists). */
				matches: z.array(z.string()).default([]),
			}),
		)
		.optional(),
});

export type WorkReport = z.infer<typeof WorkReport>;
