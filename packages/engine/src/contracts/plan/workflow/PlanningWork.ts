import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningScope } from '#src/contracts/plan/workflow/common/types/PlanningScope.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Durable logical work spans multiple evidence requests and recoverable invocation attempts. */
export const PlanningWork = z
	.object({
		id: z.string().min(1),
		role: z.enum(PlanningVocabulary.Role),
		stage: z.enum(PlanningVocabulary.Stage),
		scope: PlanningScope,
		prerequisiteIds: z.array(z.string().min(1)),
		inputDigest: PlanningDigest,
		status: z.enum(PlanningVocabulary.WorkState),
		attemptSequence: z.number().int().nonnegative(),
		currentAttemptId: z.string().min(1).optional(),
		resultReceiptId: z.string().min(1).optional(),
		failureIds: z.array(z.string().min(1)),
		diagnosisIds: z.array(z.string().min(1)),
		assignment: z.string().min(1),
	})
	.strict();
export type PlanningWork = z.infer<typeof PlanningWork>;
