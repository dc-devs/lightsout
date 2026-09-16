import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Current stage policy points to immutable execution metadata, never to an agent assertion. */
export const PlanningPolicyReference = z.object({ stage: z.enum(PlanningVocabulary.Stage), artifact: PlanningPath, sha256: PlanningDigest }).strict();
export type PlanningPolicyReference = z.infer<typeof PlanningPolicyReference>;
