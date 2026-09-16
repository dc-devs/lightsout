import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningScope } from '#src/contracts/plan/workflow/common/types/PlanningScope.ts';

/** Importer provenance preserves a legacy assertion of settlement; it never grants new approval or delegation. */
export const PlanningLegacySettlement = z
	.object({
		id: z.string().min(1),
		format: z.literal('legacy-decision-v1'),
		planName: PlanningPath,
		claimId: z.string().min(1),
		sourcePath: PlanningPath,
		artifact: PlanningPath,
		artifactDigest: PlanningDigest,
		rowIndex: z.number().int().nonnegative(),
		rowText: z.string().min(1),
		rowDigest: PlanningDigest,
		choiceDigest: PlanningDigest,
		scope: PlanningScope,
		phaseBindings: z.array(z.object({ name: z.string().min(1), phaseId: z.string().min(1).nullable() }).strict()),
	})
	.strict();
export type PlanningLegacySettlement = z.infer<typeof PlanningLegacySettlement>;
