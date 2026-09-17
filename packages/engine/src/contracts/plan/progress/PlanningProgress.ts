import { z } from 'zod';
import { PlanningStepRecord } from '#src/contracts/plan/progress/PlanningStepRecord.ts';

/**
 * What the plan subcommands last recorded about their own steps, written to
 * `planning-progress.json` in the plan folder.
 *
 * It stays on the machine: it is not one of the durable files `plan publish`
 * attaches, because only `lightsout status --planning` reads it.
 */
export const PlanningProgress = z.object({
	/** The plan folder name the record belongs to. */
	name: z.string(),
	/** ISO time of the last write. */
	updatedAt: z.string(),
	/** At most one entry per step, in PlanningStep order. A step never run has no entry. */
	steps: z.array(PlanningStepRecord),
});

export type PlanningProgress = z.infer<typeof PlanningProgress>;
