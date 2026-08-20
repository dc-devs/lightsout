import { RunStatus } from '@lightsout/engine/contracts';
import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getRunServerFn } from '#src/features/runDetail/serverFns/index.ts';

interface Params {
	/** Full run id, or the shortened form a report printed. */
	runId: string;
}

/** One run, re-fetched every three seconds while it is running and not at all once it has settled. */
export const runQueryOptions = ({ runId }: Params) =>
	queryOptions({
		queryKey: [QueryKey.Run, runId],
		queryFn: () => getRunServerFn({ data: { runId } }),
		refetchInterval: (query) => (query.state.data?.listing.status === RunStatus.Running ? 3_000 : false),
	});
