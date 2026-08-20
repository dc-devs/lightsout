import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getStandardsServerFn } from '#src/features/standards/serverFns/index.ts';

/** The standards view. Not polled: it changes only when someone runs a check. */
export const standardsQueryOptions = () =>
	queryOptions({
		queryKey: [QueryKey.Standards],
		queryFn: () => getStandardsServerFn(),
	});
