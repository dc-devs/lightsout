import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/index.ts';

/** The selected portable bytes are immutable and independent of subsequently refreshed public projections. */
export const PlanningAnchorReference = z
	.object({ format: z.literal('planning-anchor-v1'), sha256: PlanningDigest, generation: PlanningDigest, markerSha256: PlanningDigest.optional() })
	.strict();
export type PlanningAnchorReference = z.infer<typeof PlanningAnchorReference>;
