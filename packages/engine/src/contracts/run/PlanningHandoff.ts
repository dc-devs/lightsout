import { z } from 'zod';
import { PlanningDigest, PlanningPath } from '#src/contracts/plan/index.ts';

/** The immutable planning generation owns the bytes; a run freezes its address and execution order. */
export const PlanningHandoff = z
	.object({
		format: z.literal('planning-handoff-v1'),
		name: PlanningPath,
		generation: PlanningDigest,
		phases: z.array(z.object({ id: z.string().min(1), path: PlanningPath }).strict()),
	})
	.strict();
export type PlanningHandoff = z.infer<typeof PlanningHandoff>;
