/**
 * How a forge is asked to merge a pull request.
 *
 * Three values because that is what every forge offers and what `gh pr merge`
 * spells as a flag — the config names one, and the name travels to the command
 * line unchanged.
 */
export const ShipMergeMethod = {
	Merge: 'merge',
	Squash: 'squash',
	Rebase: 'rebase',
} as const;

export type ShipMergeMethod = (typeof ShipMergeMethod)[keyof typeof ShipMergeMethod];
