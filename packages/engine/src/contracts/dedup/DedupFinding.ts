import { z } from 'zod';
import { DedupVerdict } from '#src/contracts/dedup/DedupVerdict.ts';

/**
 * One confirmed prior-art duplication in `dedup.json`: the engine's
 * deterministically-detected collision (`plannedSymbol` + `collidesWith`) joined
 * with the judge agent's verdict (`recommendation`/`rationale`/`suggestedLocation`/
 * `migrateCallers`) by `plannedSymbol`. Only verdicts with `isDuplicate === true`
 * become findings — the resolution the skill applies to `plan.md`.
 */
export const DedupFinding = DedupVerdict.omit({ isDuplicate: true }).extend({
	plannedPath: z.string(),
	collidesWith: z.array(z.object({ name: z.string(), path: z.string() })).default([]),
});

export type DedupFinding = z.infer<typeof DedupFinding>;
