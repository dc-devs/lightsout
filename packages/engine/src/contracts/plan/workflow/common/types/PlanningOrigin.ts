import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';

/** Original source wording and its locator remain distinct from model explanations. */
export const PlanningOrigin = z.object({ artifact: z.string().min(1), locator: z.string().min(1), sha256: PlanningDigest, text: z.string() }).strict();
export type PlanningOrigin = z.infer<typeof PlanningOrigin>;
