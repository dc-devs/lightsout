import { z } from 'zod';
import { PlanDraftStatus } from '#src/contracts/plan/PlanDraftStatus.ts';
import { PlanVariant } from '#src/contracts/plan/PlanVariant.ts';

/**
 * The plan-writer agent's report from a `plan draft` run: the files written
 * (each with its variant and scope), how many decisions it applied, any
 * assumptions it had to make, and any discrepancies it found between the
 * decisions/facts and the codebase.
 */
export const PlanDraftReport = z.object({
	status: z.enum(PlanDraftStatus),
	filesWritten: z
		.array(
			z.object({
				path: z.string(),
				variant: z.enum(PlanVariant),
				/** The scope this file covers (a phase slug, or 'single'). */
				scope: z.string(),
			}),
		)
		.default([]),
	decisionsApplied: z.number(),
	assumptions: z.array(z.string()).default([]),
	discrepancies: z.array(z.string()).default([]),
});

export type PlanDraftReport = z.infer<typeof PlanDraftReport>;
