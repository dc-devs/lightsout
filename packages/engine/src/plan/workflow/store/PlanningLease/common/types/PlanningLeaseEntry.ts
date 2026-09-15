import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/index.ts';
import { PlanningLeaseStatus } from '#src/plan/workflow/store/PlanningLease/common/constants/PlanningLeaseStatus.ts';

/** Per-attempt local journal entries serialize renewal and recovery without publishing process metadata. */
export const PlanningLeaseEntry = z
	.object({
		revision: z.number().int().nonnegative(),
		parentDigest: PlanningDigest.nullable(),
		attemptId: z.string().min(1),
		token: z.string().min(1),
		pid: z.number().int().positive(),
		expiresAt: z.number().finite(),
		state: z.enum(PlanningLeaseStatus),
	})
	.strict();
export type PlanningLeaseEntry = z.infer<typeof PlanningLeaseEntry>;
