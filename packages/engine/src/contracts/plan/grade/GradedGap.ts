import { z } from 'zod';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import { GapVerdict } from '#src/contracts/plan/grade/GapVerdict.ts';
import { PlanGap } from '#src/contracts/plan/grade/PlanGap.ts';

/**
 * A gap as it is persisted in `grade.json`: what the reader reported, plus the
 * plan file it was found in, the lens that found it, and the judge's ruling on
 * who has to settle it. The engine stamps the phase and the lens after the
 * reader returns — the gap-check contract stays the bare `gaps` array, so an
 * agent can neither mislabel a gap's phase nor claim a lens it was not given —
 * and it stamps the outcome too whenever no judge settled the finding.
 *
 * The judge's half is spread in from `GapVerdict` rather than retyped, so the
 * shape the agent answers in and the shape written to disk stay related by
 * construction.
 */
export const GradedGap = PlanGap.extend({
	...GapVerdict.omit({ outcome: true }).shape,
	/** The plan file's basename — `phase2-cross-phase-checks.md`, or `plan.md`. */
	phase: z.string(),
	/**
	 * Optional because a finding no per-file lens produced must be able to say so
	 * rather than claim a lens it was never given. The whole-plan documentation
	 * checker is the one producer of such a finding today; `phase` stays required,
	 * because every finding is still labelled with a plan file a reader can open.
	 */
	lens: z.enum(GapCheckLens).optional(),
	/**
	 * Widened from the judge's three: `unjudged` is the engine's stamp and never
	 * the judge's to claim. The default is for parsing a `grade.json` written
	 * before this field existed — and it defaults to the blocking value, because
	 * a record that cannot say a finding was weighed has not weighed it.
	 */
	outcome: z.enum(GapOutcome).default(GapOutcome.Unjudged),
	/** Why nobody settled it, absent when a judge did. */
	unjudgedReason: z.string().optional(),
});

export type GradedGap = z.infer<typeof GradedGap>;
