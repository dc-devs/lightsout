import { z } from 'zod';
import { AdvisoryOutcome } from '@/contracts/standardsCheck/AdvisoryOutcome';
import { BatchOutcome } from '@/contracts/refactor/BatchOutcome';

/** The step-record `report` payload a refactor batch persists. */
export const BatchReport = z.object({
	outcome: z.enum(BatchOutcome),
	/** Site keys still present after the batch (empty when resolved). */
	remainingSiteKeys: z.array(z.string()),
	/** The executing agent's account of why findings were declined, from its friction entries. */
	rationale: z.array(z.string()),
	/** What the batch's agent did about each advisory it was shown, accumulated across the batch's invocations. Absent means it reported none — which is also how a manifest written before this field parses. */
	advisoryOutcomes: z.array(AdvisoryOutcome).optional(),
});

export type BatchReport = z.infer<typeof BatchReport>;
