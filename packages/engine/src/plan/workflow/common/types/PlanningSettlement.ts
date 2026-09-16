import { z } from 'zod';
import { PlanningCitation, PlanningDependency } from '#src/contracts/index.ts';

/** Immutable withdrawal evidence identifies the accepted adjudication and all observed dependencies. */
export const PlanningSettlement = z
	.object({
		format: z.literal('planning-settlement-v1'),
		findingId: z.string().min(1),
		workId: z.string().min(1),
		attemptId: z.string().min(1),
		resultReceiptId: z.string().min(1),
		invocationId: z.string().min(1),
		reason: z.string().min(1),
		citations: z.array(PlanningCitation).min(1),
		dependencies: z.array(PlanningDependency),
	})
	.strict();
export type PlanningSettlement = z.infer<typeof PlanningSettlement>;
