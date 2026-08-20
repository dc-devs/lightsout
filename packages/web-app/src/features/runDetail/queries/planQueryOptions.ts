import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getPlanServerFn } from '#src/features/runDetail/serverFns/index.ts';

interface Params {
	/** Repo-relative plan path, exactly as the manifest recorded it. */
	path: string;
}

/** A plan document, fetched when the drawer first asks for it and kept — a plan file does not change under a run that has already read it. */
export const planQueryOptions = ({ path }: Params) =>
	queryOptions({
		queryKey: [QueryKey.Plan, path],
		queryFn: () => getPlanServerFn({ data: { path } }),
		staleTime: Number.POSITIVE_INFINITY,
	});
