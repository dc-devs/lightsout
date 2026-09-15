import { z } from 'zod';

/** A content identity, never a timestamp or a model's assertion of freshness. */
export const PlanningDigest = z.string().regex(/^[a-f0-9]{64}$/);
export type PlanningDigest = z.infer<typeof PlanningDigest>;
