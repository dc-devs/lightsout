interface Params {
	count: number;
}

/**
 * A token count at the precision a reader can hold: `940`, `1.5k`, `1.2M`.
 *
 * @returns The count rounded to one decimal with a magnitude suffix, not a
 * digit string — these appear in cost tables where the exact figure is noise
 * and the order of magnitude is the whole signal.
 */
export const formatTokenCount = ({ count }: Params): string => {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}

	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
};
