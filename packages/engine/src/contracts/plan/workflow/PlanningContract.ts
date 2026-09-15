import { z } from 'zod';
import { PlanningArtifact } from '#src/contracts/plan/workflow/common/types/PlanningArtifact.ts';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningStandard } from '#src/contracts/plan/workflow/common/types/PlanningStandard.ts';
import { PlanningClaim } from '#src/contracts/plan/workflow/PlanningClaim.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** A complete fresh-context implementation input tied to one immutable generation. */
export const PlanningContract = z
	.object({
		format: z.literal('lightsout-planning-v1'),
		generation: PlanningDigest,
		phaseId: z.string().min(1).optional(),
		claims: z.array(PlanningClaim),
		interfaces: z.array(z.string()),
		invariants: z.array(z.string()),
		standards: z.array(z.object({ descriptor: PlanningStandard, text: z.string() }).strict()),
		acceptance: z.array(PlanningClaim.refine((claim) => claim.kind === PlanningVocabulary.ClaimKind.Acceptance, 'Expected acceptance mapping')),
		allowedRoots: z.array(PlanningPath),
		privateFreedom: z.string().min(1),
		predecessorReceiptIds: z.array(z.string().min(1)),
		artifacts: z.array(PlanningArtifact),
	})
	.strict();
export type PlanningContract = z.infer<typeof PlanningContract>;
