import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
}

/**
 * Every path a plan file's WRITE headings name, in heading order: creates,
 * modifies and earlier-phase modifies.
 *
 * Deliberately narrower than `getPlanHeadingPaths`, which is this list plus the
 * headings that name a file nobody writes — a deletion, and a move's source.
 * The ledger's coverage check wants exactly this narrower set, because no test
 * can state the behaviour of a file the plan removes.
 *
 * It is a spelling of its own rather than a spread inside that check for the
 * same reason its two siblings are: a path-bearing write heading added to the
 * template later is remembered here once, instead of in each caller that
 * happened to hand-roll the same three fields.
 */
export const getPlanWrittenPaths = ({ plan }: Params): string[] => [...plan.createPaths, ...plan.modifyPaths, ...plan.earlierPhaseModifyPaths];
