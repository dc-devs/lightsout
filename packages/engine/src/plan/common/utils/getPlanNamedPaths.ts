import { getPlanHeadingPaths } from '#src/plan/common/paths/getPlanHeadingPaths.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
	/** Also include `## Patterns to Mirror` — files the plan reads rather than writes, which only the script check cares about. */
	includeMirrors?: boolean;
}

/**
 * Every path a plan file names: the heading paths `getPlanHeadingPaths` spells,
 * the acceptance-test ledger's test files, and the mirrors when the caller asks
 * for them.
 *
 * This is the single spelling of "which paths a plan accounts for", for the same
 * reason `getPlanTouchedPaths` is the single spelling of the size numbers: the
 * size counts, the `packages-identifiable` check and the package-manifest scan
 * all walk the identical set, and three hand-rolled spreads over the same
 * `ParsedPlan` would agree only by accident. A fourth path-bearing heading added
 * to the template later is then remembered in one place rather than three, where
 * the one that forgot it would silently stop resolving a package manifest.
 *
 * The ledger's test files ride along because they are paths the plan itself
 * accounts for — the ledger section is their declaration, exactly as a `### `
 * heading is for a created file — so the prose-path check must not report a
 * row's backticked test path as naming nothing. They never reach the size
 * numbers: `getPlanTouchedPaths` filters this list with `isPlanSourceFile`,
 * which excludes tests.
 */
export const getPlanNamedPaths = ({ plan, includeMirrors = false }: Params): string[] => [
	...getPlanHeadingPaths({ plan }),
	...plan.ledger.map((row) => row.testFile),
	...(includeMirrors ? plan.mirrorPaths : []),
];
