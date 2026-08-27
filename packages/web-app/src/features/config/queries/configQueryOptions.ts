import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getConfigServerFn } from '#src/features/config/serverFns/getConfigServerFn.ts';

/** The resolved config. Not polled: it changes only when someone edits `lightsout.config.json`. */
export const configQueryOptions = () =>
	queryOptions({
		queryKey: [QueryKey.Config],
		queryFn: () => getConfigServerFn(),
	});
