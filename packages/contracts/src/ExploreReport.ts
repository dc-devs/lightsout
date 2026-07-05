import { z } from 'zod';
import { ExploreArea } from './ExploreArea';

/**
 * The explorer agent's contract: one or more `ExploreArea` fact bundles. One
 * explorer produces one report (usually one area); the engine merges the areas
 * across parallel explorers before verifying paths on disk.
 */
export const ExploreReport = z.object({
	areas: z.array(ExploreArea).default([]),
});

export type ExploreReport = z.infer<typeof ExploreReport>;
