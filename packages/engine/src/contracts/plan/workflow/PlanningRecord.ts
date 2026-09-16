import { z } from 'zod';
import { PlanningArtifact } from '#src/contracts/plan/workflow/common/types/PlanningArtifact.ts';
import { PlanningConfirmation } from '#src/contracts/plan/workflow/common/types/PlanningConfirmation.ts';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningLegacySettlement } from '#src/contracts/plan/workflow/common/types/PlanningLegacySettlement.ts';
import { PlanningOrigin } from '#src/contracts/plan/workflow/common/types/PlanningOrigin.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningPolicyReference } from '#src/contracts/plan/workflow/common/types/PlanningPolicyReference.ts';
import { PlanningStandard } from '#src/contracts/plan/workflow/common/types/PlanningStandard.ts';
import { PlanningClaim } from '#src/contracts/plan/workflow/PlanningClaim.ts';
import { PlanningEvidence } from '#src/contracts/plan/workflow/PlanningEvidence.ts';
import { PlanningFinding } from '#src/contracts/plan/workflow/PlanningFinding.ts';
import { PlanningReviewReceipt } from '#src/contracts/plan/workflow/PlanningReviewReceipt.ts';
import { PlanningWork } from '#src/contracts/plan/workflow/PlanningWork.ts';

/** Authoritative portable state. Required collections cannot disappear through defaulting. */
export const PlanningRecord = z
	.object({
		schemaVersion: z.literal(1),
		planName: PlanningPath,
		revision: z.number().int().nonnegative(),
		parentDigest: PlanningDigest.nullable(),
		sources: z.array(PlanningOrigin),
		claims: z.array(PlanningClaim),
		evidence: z.array(PlanningEvidence),
		work: z.array(PlanningWork),
		findings: z.array(PlanningFinding),
		reviewReceipts: z.array(PlanningReviewReceipt),
		artifacts: z.array(PlanningArtifact),
		confirmations: z.array(PlanningConfirmation),
		standards: z.array(PlanningStandard),
		legacySettlements: z.array(PlanningLegacySettlement).optional(),
		executionPolicies: z.array(PlanningPolicyReference).optional(),
	})
	.strict();
export type PlanningRecord = z.infer<typeof PlanningRecord>;
