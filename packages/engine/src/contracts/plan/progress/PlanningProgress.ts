import { z } from 'zod';
import { PlanningCanonicalProgress } from '#src/contracts/plan/progress/PlanningCanonicalProgress.ts';
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
	/** ISO time of the last write for a record on disk, and of the reading itself for a canonical projection, which is never written. */
	updatedAt: z.string(),
	/** At most one entry per step, in PlanningStep order. A step never run has no entry. */
	steps: z.array(PlanningStepRecord),
	/**
	 * The canonical planning store's own state, projected on read. Present only
	 * for a plan the store holds a verified generation for, and never written to
	 * `planning-progress.json` — a reader that finds it should prefer it, and a
	 * reader that does not still has the five legacy steps above.
	 */
	canonical: PlanningCanonicalProgress.optional(),
});

export type PlanningProgress = z.infer<typeof PlanningProgress>;
