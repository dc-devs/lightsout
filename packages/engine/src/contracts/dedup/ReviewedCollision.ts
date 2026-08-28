import { z } from 'zod';

/**
 * One name-collision a dedup pass ruled on, whatever the ruling.
 *
 * `findings` holds only the duplications the judge confirmed, so a collision
 * ruled distinct leaves no trace there. That absence is indistinguishable from
 * a collision nobody has looked at, and `plan grade`'s advisory nudge — "run
 * `plan dedup`" — was reading it as the second. This is the record that tells
 * the two apart: every collision the pass weighed, findings included.
 *
 * Identity is the triple, not the symbol alone. The same name planned at two
 * paths, or in two phases, is two separate rulings.
 */
export const ReviewedCollision = z.object({
	plannedSymbol: z.string(),
	/** Repo-relative Files-to-Create path the symbol would be created at. */
	plannedPath: z.string(),
	/** Basename of the plan file whose `## Files to Create` declared it. */
	phase: z.string(),
});

export type ReviewedCollision = z.infer<typeof ReviewedCollision>;
