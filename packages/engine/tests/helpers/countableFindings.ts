import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';

interface Params {
	/** How many findings the list holds. */
	count: number;
	/** The rule these findings answer to, which also keeps one list's site keys distinct from the next list's. */
	rule: string;
}

/**
 * As many distinct standards findings as a list needs, and nothing beyond that.
 *
 * A reader that reports how LONG a list was is pinned by the count alone, so
 * these only have to be distinct from each other — give each list a different
 * length and a reader that read the wrong one reports the wrong number.
 */
export const countableFindings = ({ count, rule }: Params): StandardsFinding[] =>
	Array.from({ length: count }, (_, index) => ({
		rule,
		severity: StandardsSeverity.Blocking,
		siteKey: `${rule}:packages/engine/src/${index}.ts`,
		files: [{ path: `packages/engine/src/${index}.ts` }],
		detail: 'a finding',
	}));
