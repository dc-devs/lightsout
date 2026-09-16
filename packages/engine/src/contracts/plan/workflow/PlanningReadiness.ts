import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Derived engine result, never a field a model may set on PlanningRecord. */
export const PlanningReadiness = z
	.object({
		target: z.enum(PlanningVocabulary.Target),
		ready: z.boolean(),
		generation: PlanningDigest,
		inputDigest: PlanningDigest,
		structuralFailures: z.array(z.string()),
		uncoveredClaimIds: z.array(z.string().min(1)),
		openBlockerIds: z.array(z.string().min(1)),
		unresolvedQuestionIds: z.array(z.string().min(1)),
		integrationReceiptId: z.string().min(1).optional(),
		missingReason: z.string().optional(),
	})
	.strict()
	.refine(
		(result) =>
			!result.ready ||
			(result.structuralFailures.length === 0 &&
				result.uncoveredClaimIds.length === 0 &&
				result.openBlockerIds.length === 0 &&
				result.unresolvedQuestionIds.length === 0 &&
				(result.target === PlanningVocabulary.Target.Alignment || result.integrationReceiptId !== undefined) &&
				result.missingReason === undefined),
		'Readiness requires current review evidence and no outstanding obligations',
	);
export type PlanningReadiness = z.infer<typeof PlanningReadiness>;
