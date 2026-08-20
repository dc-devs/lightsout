import { z } from 'zod';
import { ExploreArea } from '#src/contracts/plan/ExploreArea.ts';
import { PathVerification } from '#src/contracts/plan/PathVerification.ts';

/**
 * The persisted `facts.json` for a plan workspace: the request, the merged
 * explorer areas, the deterministic on-disk verification, and when it was
 * verified. This verified-facts foundation is what lets a fresh-context agent
 * implement from the plan without guessing.
 */
export const PlanFacts = z.object({
	request: z.string(),
	areas: z.array(ExploreArea).default([]),
	verification: PathVerification,
	verifiedAt: z.string(),
});

export type PlanFacts = z.infer<typeof PlanFacts>;
