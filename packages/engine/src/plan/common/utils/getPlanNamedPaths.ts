import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
	/** Also include `## Patterns to Mirror` — files the plan reads rather than writes, which only the script check cares about. */
	includeMirrors?: boolean;
}

/**
 * Every path a plan file names, in heading order: creates, modifies,
 * earlier-phase modifies, deletes and both sides of every move — plus the
 * mirrors when the caller asks for them.
 *
 * This is the single spelling of "which sections carry paths", for the same
 * reason `getPlanTouchedPaths` is the single spelling of the size numbers: the
 * size counts, the `packages-identifiable` check and the package-manifest scan
 * all walk the identical set, and three hand-rolled spreads over the same
 * `ParsedPlan` would agree only by accident. A fourth path-bearing heading added
 * to the template later is then remembered in one place rather than three, where
 * the one that forgot it would silently stop resolving a package manifest.
 */
export const getPlanNamedPaths = ({ plan, includeMirrors = false }: Params): string[] => [
	...plan.createPaths,
	...plan.modifyPaths,
	...plan.earlierPhaseModifyPaths,
	...plan.deletePaths,
	...plan.movePaths.flatMap((move) => [move.from, move.to]),
	...(includeMirrors ? plan.mirrorPaths : []),
];
