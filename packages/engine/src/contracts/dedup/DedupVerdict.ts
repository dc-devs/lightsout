import { z } from 'zod';
import { DedupResolution } from '#src/contracts/dedup/DedupResolution.ts';

/**
 * The judge agent's ruling on one detected name collision: whether the planned
 * symbol is a real duplicate, which resolution it recommends, and — for
 * `extract` — where the shared symbol should live plus which existing callers
 * should migrate to it.
 */
export const DedupVerdict = z.object({
	plannedSymbol: z.string(),
	isDuplicate: z.boolean(),
	recommendation: z.enum(DedupResolution),
	rationale: z.string(),
	suggestedLocation: z.string().optional(),
	migrateCallers: z.array(z.string()).default([]),
});

export type DedupVerdict = z.infer<typeof DedupVerdict>;
