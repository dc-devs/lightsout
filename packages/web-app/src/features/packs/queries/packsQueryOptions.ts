import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { listPacksServerFn } from '#src/features/packs/serverFns/listPacksServerFn.ts';

/** The packs this repo loads. Not polled: the list changes only when someone edits the config or adds a pack. */
export const packsQueryOptions = () =>
	queryOptions({
		queryKey: [QueryKey.Packs],
		queryFn: () => listPacksServerFn(),
	});
