import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '../../../common/constants/QueryKey';
import { findAllIssuesServerFn } from '../serverFns/findAllIssues';

interface Params {
	search: string;
}

// One place the key and the fetcher are paired, so every screen that wants
// issues shares a cache entry.
export const issuesQueryOptions = ({ search }: Params) =>
	queryOptions({
		queryKey: [QueryKey.Issues, search],
		queryFn: () => findAllIssuesServerFn({ data: { search } }),
	});
