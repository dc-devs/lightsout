import { z } from 'zod';

/** A coordinator step's report: the per-phase run that implemented this phase. */
export const PhaseReport = z.object({
	runId: z.string(),
});

export type PhaseReport = z.infer<typeof PhaseReport>;
