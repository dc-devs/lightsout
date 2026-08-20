import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getRepoRootServerFn } from '#src/features/app/serverFns/index.ts';

/** Which repo the app has open — read once and cached, since it only changes when the server restarts. */
export const repoRootQueryOptions = () =>
	queryOptions({
		queryKey: [QueryKey.RepoRoot],
		queryFn: () => getRepoRootServerFn(),
	});
