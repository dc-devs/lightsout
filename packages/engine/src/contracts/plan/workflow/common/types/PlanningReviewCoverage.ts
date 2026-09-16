import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Both proposed reviews and accepted receipts state the same exact coverage obligation. */
export const PlanningReviewCoverage = z
	.object({
		claimIds: z.array(z.string().min(1)),
		phaseIds: z.array(z.string().min(1)),
		/** Actual full-source challenge; absent legacy rows establish no new original-intent coverage. */
		sourceDigests: z.array(PlanningDigest).optional(),
		/** Concrete implementation views inspected by this distinct invocation. */
		artifactPaths: z.array(PlanningPath).optional(),
		adequacy: z.string().min(1),
		outcome: z.enum(PlanningVocabulary.Review),
	})
	.strict();
export type PlanningReviewCoverage = z.infer<typeof PlanningReviewCoverage>;
