import { z } from 'zod';
import { PlanningAdjudicationRequest } from '#src/contracts/index.ts';

/** Persisted dispute authority binds its original request to the engine-created adjudication assignment. */
export const PlanningSavedAdjudicationRequest = z.object({ workId: z.string().min(1), request: PlanningAdjudicationRequest }).strict();
export type PlanningSavedAdjudicationRequest = z.infer<typeof PlanningSavedAdjudicationRequest>;
