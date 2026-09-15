import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';

/** Exact artifact evidence used to verify a finding or challenge its applicability. */
export const PlanningCitation = z.object({ artifact: z.string().min(1), quote: z.string().min(1), sha256: PlanningDigest }).strict();
export type PlanningCitation = z.infer<typeof PlanningCitation>;
