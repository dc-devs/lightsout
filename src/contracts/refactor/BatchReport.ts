import { z } from 'zod';
import { BatchOutcome } from '@/contracts/refactor/BatchOutcome';

/** The step-record `report` payload a refactor batch persists. */
export const BatchReport = z.object({
	outcome: z.enum(BatchOutcome),
	/** Site keys still present after the batch (empty when resolved). */
	remainingSiteKeys: z.array(z.string()),
	/** The executing agent's account of why findings were declined, from its friction entries. */
	rationale: z.array(z.string()),
});

export type BatchReport = z.infer<typeof BatchReport>;
