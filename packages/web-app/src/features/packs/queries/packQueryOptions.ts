import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getPackServerFn } from '#src/features/packs/serverFns/getPackServerFn.ts';

interface Params {
	/** The pack's own `name`, which is what the URL carries. */
	name: string;
}

/** One pack's documents and rule rows. Not polled: a pack changes only when someone edits it on disk. */
export const packQueryOptions = ({ name }: Params) =>
	queryOptions({
		queryKey: [QueryKey.Pack, name],
		queryFn: () => getPackServerFn({ data: { name } }),
	});
