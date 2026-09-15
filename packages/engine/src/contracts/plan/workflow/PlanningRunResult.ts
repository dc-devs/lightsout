import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningQuestion } from '#src/contracts/plan/workflow/common/types/PlanningQuestion.ts';
import { PlanningReadiness } from '#src/contracts/plan/workflow/PlanningReadiness.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

const identity = { name: PlanningPath, generation: PlanningDigest };
/** Alignment is not implementation completion; incomplete outcomes never claim success. */
export const PlanningRunResult = z
	.discriminatedUnion('status', [
		z
			.object({
				...identity,
				status: z.literal(PlanningVocabulary.Status.Complete),
				deliverables: z.array(PlanningPath).min(1),
				readiness: PlanningReadiness.refine(
					(value) => value.ready && value.target === PlanningVocabulary.Target.Implementation,
					'Implementation must be ready',
				),
			})
			.strict(),
		z
			.object({
				...identity,
				status: z.literal(PlanningVocabulary.Status.Aligned),
				readiness: PlanningReadiness.refine((value) => value.ready && value.target === PlanningVocabulary.Target.Alignment, 'Brainstorm must be aligned'),
				sourceDigest: PlanningDigest,
				confirmationId: z.string().min(1),
				challengeReceiptId: z.string().min(1),
			})
			.strict(),
		z
			.object({
				...identity,
				status: z.literal(PlanningVocabulary.Status.AwaitingUser),
				questionId: z.string().min(1),
				checkpointRevision: z.number().int().nonnegative(),
				questionDigest: PlanningDigest,
				question: PlanningQuestion,
			})
			.strict(),
		z
			.object({ ...identity, status: z.literal(PlanningVocabulary.Status.ExternallyBlocked), cause: z.string().min(1), continuation: z.string().min(1) })
			.strict(),
	])
	.refine(
		(result) =>
			(result.status !== PlanningVocabulary.Status.Complete && result.status !== PlanningVocabulary.Status.Aligned) ||
			result.generation === result.readiness.generation,
		'Completion must certify the same generation',
	);
export type PlanningRunResult = z.infer<typeof PlanningRunResult>;
