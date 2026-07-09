import { z } from 'zod';
import { ExploreArea } from './ExploreArea';

/**
 * The session-authored facts for a plan, before the engine stamps its on-disk
 * verification: the feature request plus the per-area fact bundles the
 * conducting session confirmed by reading the codebase. `plan verify-facts`
 * parses `facts.json` against this shape (parse-don't-cast), verifies every
 * claimed path/script, and rewrites the file as a full `PlanFacts`.
 */
export const AuthoredFacts = z.object({
	request: z.string(),
	areas: z.array(ExploreArea).default([]),
});

export type AuthoredFacts = z.infer<typeof AuthoredFacts>;
