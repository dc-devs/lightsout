import type { SortDirection } from '#src/common/constants/SortDirection.ts';

/**
 * What a reader has narrowed the runs table to, and the order they left it in.
 *
 * The two lists are empty rather than absent when nothing is selected, because
 * "narrow to none of them" is not a thing a filter can mean — an empty list is
 * how a set filter spells "all".
 */
export interface RunFilters {
	/** Command values from `getRunCommand`; empty means all. */
	commands: string[];
	/** Status families from `runStatusFamilies`; empty means all. */
	statuses: string[];
	/** Case-insensitive substring over the title. */
	text?: string;
	sortKey?: string;
	sortDirection?: SortDirection;
}
