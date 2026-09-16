import { z } from 'zod';
import { PlanningConfirmation, PlanningDigest, PlanningQuestion } from '#src/contracts/index.ts';
import { PlanningProposalPosition } from '#src/plan/workflow/common/constants/PlanningProposalPosition.ts';

/** A foreground answer must identify this exact persisted question and any explicitly proposed alignment basis. */
export const PlanningQuestionCheckpoint = z
	.object({
		questionId: z.string().min(1),
		questionDigest: PlanningDigest,
		question: PlanningQuestion,
		sourceDigest: PlanningDigest,
		checkpointRevision: z.number().int().nonnegative(),
		alignment: PlanningConfirmation.shape.alignment,
		proposal: z
			.object({ position: z.enum(PlanningProposalPosition), digest: PlanningDigest })
			.strict()
			.optional(),
	})
	.strict();
export type PlanningQuestionCheckpoint = z.infer<typeof PlanningQuestionCheckpoint>;
