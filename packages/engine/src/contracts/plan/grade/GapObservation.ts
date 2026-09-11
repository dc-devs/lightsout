import { z } from 'zod';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { PlanGap } from '#src/contracts/plan/grade/PlanGap.ts';

/**
 * One reader's report of a defect at one location: what it found, and the plan
 * file and lens it was found with. It is the unit a judge batch is assembled
 * from, the unit a group ruling covers, and what a durable record holds several
 * of once a judge confirms they describe one defect.
 *
 * It is the identity half of `GradedGap`, extracted so a gap and a record can
 * each hold a list of them without retyping the shape.
 */
export const GapObservation = PlanGap.extend({
	/** The plan file's basename — `phase2-cross-phase-checks.md`, or `plan.md`. */
	phase: z.string(),
	/**
	 * Optional because a finding no per-file lens produced must be able to say so
	 * rather than claim a lens it was never given. The whole-plan documentation
	 * checker is the one producer of such a finding today; `phase` stays required,
	 * because every finding is still labelled with a plan file a reader can open.
	 */
	lens: z.enum(GapCheckLens).optional(),
});

export type GapObservation = z.infer<typeof GapObservation>;
