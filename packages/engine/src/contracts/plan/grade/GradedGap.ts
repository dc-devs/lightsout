import { z } from 'zod';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { PlanGap } from '#src/contracts/plan/grade/PlanGap.ts';

/**
 * A gap as it is persisted in `grade.json`: what the agent reported, plus the
 * plan file it was found in and the lens that found it. The engine stamps both
 * after the agent returns — the gap-check contract stays the bare `gaps` array,
 * so an agent can neither mislabel a gap's phase nor claim a lens it was not
 * given.
 */
export const GradedGap = PlanGap.extend({
	/** The plan file's basename — `phase2-cross-phase-checks.md`, or `plan.md`. */
	phase: z.string(),
	lens: z.enum(GapCheckLens),
});

export type GradedGap = z.infer<typeof GradedGap>;
