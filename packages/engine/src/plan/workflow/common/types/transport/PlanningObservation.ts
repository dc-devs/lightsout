import { z } from 'zod';
import { PlanningEvidence, PlanningEvidenceRequest } from '#src/contracts/index.ts';

/** Exact local acquisition; only its source content may be excluded from portable handoff. */
export const PlanningObservation = z
	.object({
		request: PlanningEvidenceRequest,
		evidence: PlanningEvidence,
		content: z.string(),
		omissions: z.array(z.object({ path: z.string(), kind: z.string(), target: z.string().optional() }).strict()).optional(),
	})
	.strict();
export type PlanningObservation = z.infer<typeof PlanningObservation>;
