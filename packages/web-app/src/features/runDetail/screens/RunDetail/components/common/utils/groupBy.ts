interface Params<T> {
	items: T[];
	/** The heading each item belongs under — its area, its folder, whatever the panel groups by. */
	getKey: (item: T) => string;
}

/**
 * The items gathered under the key each answers to, keys in the order they
 * first appeared.
 *
 * Insertion order rather than sorted order on purpose: both panels using this
 * show the run's own sequence, and re-ordering would claim a ranking the
 * evidence does not carry.
 */
export const groupBy = <T>({ items, getKey }: Params<T>): [string, T[]][] => {
	const groups = new Map<string, T[]>();

	for (const item of items) {
		const key = getKey(item);

		groups.set(key, [...(groups.get(key) ?? []), item]);
	}

	return [...groups];
};
