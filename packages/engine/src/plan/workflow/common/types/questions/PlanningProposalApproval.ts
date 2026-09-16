import { z } from 'zod';
import { PlanningConfirmation, PlanningDigest } from '#src/contracts/index.ts';

/** Foreground proposal approval is a workflow checkpoint, not a new product decision or original source. */
export const PlanningProposalApproval = z
	.object({
		format: z.literal('planning-proposal-approval-v1'),
		questionId: z.string().min(1),
		questionDigest: PlanningDigest,
		checkpointRevision: z.number().int().nonnegative(),
		acceptedRevision: z.number().int().positive(),
		confirmation: PlanningConfirmation,
	})
	.strict();
export type PlanningProposalApproval = z.infer<typeof PlanningProposalApproval>;
