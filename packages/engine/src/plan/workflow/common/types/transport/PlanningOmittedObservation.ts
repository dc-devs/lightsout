import { z } from 'zod';
import { PlanningDigest, PlanningPath } from '#src/contracts/index.ts';
import { PlanningObservation } from '#src/plan/workflow/common/types/transport/PlanningObservation.ts';

/** Marker-bound absence retains acquisition and dependency identity, never phantom source bytes. */
export const PlanningOmittedObservation = z
	.object({
		path: PlanningPath.regex(/^planning-observations\/[a-f0-9]{64}\.json$/),
		sha256: PlanningDigest,
		observation: PlanningObservation.omit({ content: true }),
	})
	.strict();
export type PlanningOmittedObservation = z.infer<typeof PlanningOmittedObservation>;
