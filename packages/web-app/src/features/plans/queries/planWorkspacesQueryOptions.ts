import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { listPlanWorkspacesServerFn } from '#src/features/plans/serverFns/listPlanWorkspacesServerFn.ts';

/** Every plan workspace this repo has. Not polled: a workspace changes only when someone runs a planning command. */
export const planWorkspacesQueryOptions = () =>
	queryOptions({
		queryKey: [QueryKey.PlanWorkspaces],
		queryFn: () => listPlanWorkspacesServerFn(),
	});
