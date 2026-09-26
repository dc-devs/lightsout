import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getDefaultPackServerFn } from '#src/features/packs/internal/serverFns/getDefaultPackServerFn.ts';

/** The default pack's documents and rule rows. Never stale: it is bundled into the app and cannot change while it runs. */
export const defaultPackQueryOptions = () =>
	queryOptions({
		queryKey: [QueryKey.DefaultPack],
		queryFn: () => getDefaultPackServerFn(),
		staleTime: Number.POSITIVE_INFINITY,
	});
