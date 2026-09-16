import { z } from 'zod';
import { PlanningDigest, PlanningPath, PlanningRecord } from '#src/contracts/index.ts';
import { PlanningOmittedObservation } from '#src/plan/workflow/common/types/transport/PlanningOmittedObservation.ts';

/** One original generation with all authority bytes and an exact list of omitted local source acquisitions. */
export const PlanningPortableGeneration = z
	.object({
		format: z.literal('planning-generation-v1'),
		generation: PlanningDigest,
		record: PlanningRecord,
		artifacts: z.array(z.object({ path: PlanningPath, content: z.string() }).strict()),
		omittedObservations: z.array(PlanningOmittedObservation),
	})
	.strict();
export type PlanningPortableGeneration = z.infer<typeof PlanningPortableGeneration>;
