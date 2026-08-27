import type { FrictionArea, FrictionRecord } from '@lightsout/engine';

interface Params {
	records: FrictionRecord[];
	/** Areas to keep; empty means no area filter rather than no rows. */
	areas: FrictionArea[];
	/** Matched against the entry's own words, case-insensitively. */
	text?: string;
}

/**
 * The entries a reader asked for.
 *
 * The text match reads `detail` and `kind` and nothing else. The run's title is
 * joined in for display afterwards, so a filter typed while the runs query is
 * still in flight narrows the same rows it will narrow a second later — a filter
 * whose answer depends on what has loaded is a filter nobody can trust.
 */
export const filterFriction = ({ records, areas, text }: Params): FrictionRecord[] => {
	const needle = text?.trim().toLowerCase() ?? '';

	return records.filter((record) => {
		const matchesArea = areas.length === 0 || areas.includes(record.area);
		const matchesText = needle === '' || `${record.detail} ${record.kind ?? ''}`.toLowerCase().includes(needle);

		return matchesArea && matchesText;
	});
};
