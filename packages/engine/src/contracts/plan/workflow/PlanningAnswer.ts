import { z } from 'zod';
import { PlanningConfirmation } from '#src/contracts/plan/workflow/common/types/PlanningConfirmation.ts';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';

/** Answers identify the exact durable checkpoint and carry foreground message provenance. */
export const PlanningAnswer = z
	.object({
		questionId: z.string().min(1),
		checkpointRevision: z.number().int().nonnegative(),
		questionDigest: PlanningDigest,
		selectedOption: z.string().min(1).optional(),
		freeText: z.string().min(1).optional(),
		confirmation: PlanningConfirmation,
	})
	.strict()
	.refine((answer) => answer.selectedOption !== undefined || answer.freeText !== undefined, 'An answer requires a selection or text');
export type PlanningAnswer = z.infer<typeof PlanningAnswer>;
