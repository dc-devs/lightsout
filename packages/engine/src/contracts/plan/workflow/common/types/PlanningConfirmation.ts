import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningScope } from '#src/contracts/plan/workflow/common/types/PlanningScope.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Foreground/relay assertion of an actual user message; a model cannot mint this receipt. */
export const PlanningConfirmation = z
	.object({
		id: z.string().min(1),
		channel: z.enum(PlanningVocabulary.ConfirmationChannel),
		messageId: z.string().min(1),
		messageText: z.string().min(1),
		approvedDigest: PlanningDigest,
		delegation: PlanningScope,
		/** Explicit final design approval; ordinary question answers never acquire this purpose. */
		alignment: z
			.object({ sourceDigest: PlanningDigest, semanticDigest: PlanningDigest, challengeReceiptId: z.string().min(1) })
			.strict()
			.optional(),
	})
	.strict();
export type PlanningConfirmation = z.infer<typeof PlanningConfirmation>;
