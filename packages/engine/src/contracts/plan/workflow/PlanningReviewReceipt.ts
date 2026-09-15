import { z } from 'zod';
import { PlanningCitation } from '#src/contracts/plan/workflow/common/types/PlanningCitation.ts';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningReviewCoverage } from '#src/contracts/plan/workflow/common/types/PlanningReviewCoverage.ts';
import { PlanningDependency } from '#src/contracts/plan/workflow/PlanningDependency.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Engine-issued evidence of a distinct reviewing invocation over identified semantic inputs. */
export const PlanningReviewReceipt = z
	.object({
		id: z.string().min(1),
		workId: z.string().min(1),
		attemptId: z.string().min(1),
		authorAttemptIds: z.array(z.string().min(1)).min(1),
		role: z.enum(PlanningVocabulary.Role),
		inputDigest: PlanningDigest,
		coverage: PlanningReviewCoverage,
		dependencies: z.array(PlanningDependency),
		issuer: z.object({ agent: z.string().min(1), invocationId: z.string().min(1) }).strict(),
		findingIds: z.array(z.string().min(1)),
		verifiedFindings: z.array(z.object({ findingId: z.string().min(1), citations: z.array(PlanningCitation).min(1) }).strict()),
		completedAt: z.string().datetime(),
		integrationDigest: PlanningDigest.optional(),
	})
	.strict()
	.refine((receipt) => !receipt.authorAttemptIds.includes(receipt.attemptId), 'An author cannot supply its own independent review');
export type PlanningReviewReceipt = z.infer<typeof PlanningReviewReceipt>;
