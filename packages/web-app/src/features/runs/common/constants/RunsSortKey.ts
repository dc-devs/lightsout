/**
 * The runs table columns a reader can order by, and the URL's own vocabulary
 * for `sortKey`.
 *
 * Only the sortable ones: the packages and resume columns say nothing a row
 * could be ordered by, so a URL naming either would ask for an order the table
 * cannot produce.
 */
export const RunsSortKey = {
	Status: 'status',
	Title: 'title',
	Command: 'command',
	Steps: 'steps',
	Files: 'files',
	Cost: 'cost',
	Updated: 'updatedAt',
} as const;

export type RunsSortKey = (typeof RunsSortKey)[keyof typeof RunsSortKey];
