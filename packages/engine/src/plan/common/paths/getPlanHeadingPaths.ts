import { getPlanWrittenPaths } from '#src/plan/common/paths/getPlanWrittenPaths.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
}

/**
 * Every path one of a plan's file headings names, in heading order: the write
 * headings `getPlanWrittenPaths` spells, then deletes and both sides of every
 * move.
 *
 * This is the single spelling of "which headings carry paths". `getPlanNamedPaths`
 * is this list plus the paths a plan accounts for elsewhere — the ledger's test
 * files, and the mirrors when its caller asks for them — so a heading added to
 * the template later is remembered here once rather than in each caller that
 * happens to want the headings alone.
 */
export const getPlanHeadingPaths = ({ plan }: Params): string[] => [
	...getPlanWrittenPaths({ plan }),
	...plan.deletePaths,
	...plan.movePaths.flatMap((move) => [move.from, move.to]),
];
