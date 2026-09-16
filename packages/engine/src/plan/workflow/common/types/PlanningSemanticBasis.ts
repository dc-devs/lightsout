import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/index.ts';

/** Explicit permanent input selectors separate producer history from current output assurance. */
export const PlanningSemanticBasis = z
	.object({
		claimIds: z.array(z.string()),
		evidenceIds: z.array(z.string()),
		artifactPaths: z.array(z.string()),
		findingIds: z.array(z.string()),
		digest: PlanningDigest,
	})
	.strict();
export type PlanningSemanticBasis = z.infer<typeof PlanningSemanticBasis>;
