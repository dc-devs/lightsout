import { isPlanSourceFile } from '#src/plan/common/paths/isPlanSourceFile.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { getPlanNamedPaths } from '#src/plan/common/utils/getPlanNamedPaths.ts';

interface Params {
	plan: ParsedPlan;
}

/**
 * The created and touched path sets one plan file declares, filtered to source
 * files. `created` is Files to Create ONLY; `touched` is that plus modifies,
 * earlier-phase modifies, deletes and both sides of every move, de-duplicated.
 *
 * A move destination is deliberately not a creation. The created-file ceiling
 * measures how much a phase must SPECIFY — a created file needs its signatures,
 * exports and behaviour written out — and a moved file is already written; the
 * plan states where it goes, in one line. Counting moves as creations would
 * block a phase relocating thirty-one files against a ceiling that is not
 * declarable, with no escape: `## File Budget` raises the touched count and
 * never the ceiling. Moves are still counted in `touched`, on both sides, so a
 * large relocation shows up where it belongs.
 *
 * Extracted alongside the predicate for the same reason: the lint's two size
 * checks, the count stamp and the declaration-consistency check must all arrive
 * at the same two numbers, and three hand-rolled reductions over the same
 * `ParsedPlan` would agree only by accident. Which sections carry paths at all
 * is `getPlanNamedPaths`, so this stays a filter over that one list rather than
 * a second spelling of it.
 */
export const getPlanTouchedPaths = ({ plan }: Params): { created: string[]; touched: string[] } => {
	const created = plan.createPaths.filter((path) => isPlanSourceFile({ path }));
	const touched = getPlanNamedPaths({ plan }).filter((path) => isPlanSourceFile({ path }));

	return { created: [...new Set(created)], touched: [...new Set(touched)] };
};
