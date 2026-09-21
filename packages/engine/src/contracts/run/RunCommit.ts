import { z } from 'zod';

/**
 * One commit a run left behind.
 *
 * Strict, for the reason every record contract here is: a field a newer engine
 * wrote must fail the parse rather than be silently stripped and written back
 * missing.
 */
export const RunCommit = z
	.object({
		/** The commit git made, as `git rev-parse HEAD` answered it straight after. */
		sha: z.string(),
		/** The subject line this unit of work was committed under. */
		subject: z.string(),
		/** The run that made it — a phase's own child run id, which is why a coordinator's list can name several. */
		runId: z.string(),
	})
	.strict();

export type RunCommit = z.infer<typeof RunCommit>;
