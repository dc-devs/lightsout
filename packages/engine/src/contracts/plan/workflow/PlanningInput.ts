import { z } from 'zod';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningConfirmation } from '#src/contracts/plan/workflow/common/types/PlanningConfirmation.ts';
import { PlanningOrigin } from '#src/contracts/plan/workflow/common/types/PlanningOrigin.ts';
import { PlanningClaim } from '#src/contracts/plan/workflow/PlanningClaim.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Foreground ingestion, distinct from untrusted role proposals and imported ticket content. */
export const PlanningInput = z
	.object({
		stage: z.enum(PlanningVocabulary.Stage),
		sources: z.array(PlanningOrigin),
		claims: z.array(PlanningClaim),
		confirmations: z.array(PlanningConfirmation),
	})
	.strict()
	.superRefine((input, context) => {
		for (const [index, claim] of input.claims.entries()) {
			if (claim.legacySettlementId !== undefined)
				context.addIssue({ code: 'custom', path: ['claims', index], message: 'Foreground input cannot mint historical settlement' });
		}
		for (const [index, source] of input.sources.entries()) {
			if (sha256({ content: source.text }) !== source.sha256)
				context.addIssue({ code: 'custom', path: ['sources', index, 'sha256'], message: 'Source digest does not match original text' });
		}
	});
export type PlanningInput = z.infer<typeof PlanningInput>;
