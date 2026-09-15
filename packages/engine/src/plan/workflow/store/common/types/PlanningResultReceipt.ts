import { z } from 'zod';
import { PlanningDigest, PlanningPath, PlanningVocabulary } from '#src/contracts/index.ts';

/** Compact acceptance provenance; original proposals and invocation transcripts remain local. */
export const PlanningResultReceipt = z
	.object({
		id: z.string().min(1),
		workId: z.string().min(1),
		attemptId: z.string().min(1),
		role: z.enum(PlanningVocabulary.Role),
		inputDigest: PlanningDigest,
		resultDigest: PlanningDigest,
		acceptedFromDigest: PlanningDigest,
		acceptedRevision: z.number().int().nonnegative(),
		effects: z
			.object({
				claimIds: z.array(z.string().min(1)),
				evidenceIds: z.array(z.string().min(1)),
				findingIds: z.array(z.string().min(1)),
				reviewReceiptIds: z.array(z.string().min(1)),
				artifacts: z.array(z.object({ path: PlanningPath, sha256: PlanningDigest }).strict()),
			})
			.strict(),
	})
	.strict();
export type PlanningResultReceipt = z.infer<typeof PlanningResultReceipt>;
