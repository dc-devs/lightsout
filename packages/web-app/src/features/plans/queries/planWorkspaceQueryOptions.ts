import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getPlanWorkspaceServerFn } from '#src/features/plans/serverFns/getPlanWorkspaceServerFn.ts';

interface Params {
	/** The workspace's kebab folder name, which is what the URL carries. */
	name: string;
}

/** One plan workspace, whole. Not polled, for the reason the list is not: nothing writes here but a planning command. */
export const planWorkspaceQueryOptions = ({ name }: Params) =>
	queryOptions({
		queryKey: [QueryKey.PlanWorkspace, name],
		queryFn: () => getPlanWorkspaceServerFn({ data: { name } }),
	});
