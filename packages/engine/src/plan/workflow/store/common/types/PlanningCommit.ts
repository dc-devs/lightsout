import { z } from 'zod';
import { PlanningDigest, PlanningRecord } from '#src/contracts/index.ts';

/** The stored checksum protects the tip generation even before a successor records its digest. */
export const PlanningCommit = z.object({ digest: PlanningDigest, record: PlanningRecord }).strict();
export type PlanningCommit = z.infer<typeof PlanningCommit>;
