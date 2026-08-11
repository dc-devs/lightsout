import type { TableFilterState } from '../common/types/TableFilterState';

// The original type used directly. Where the distinction matters, a comment at
// the usage site says so — cheaper than a file that only renames it.
export const getIssueQuery = ({ filters }: { filters: TableFilterState }): string => `?q=${filters.query}&page=${filters.page}`;
