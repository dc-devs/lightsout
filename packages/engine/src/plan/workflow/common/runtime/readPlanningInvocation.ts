import { PlanningInvocation } from '#src/plan/workflow/common/types/PlanningInvocation.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	workId: string;
}

/** Read the latest canonical binding for a work item, never a local transcript or stale pointer. */
export const readPlanningInvocation = ({ snapshot, workId }: Params): PlanningInvocation | undefined => {
	const invocations = [...snapshot.artifacts]
		.filter(([path]) => path.startsWith('planning-invocations/'))
		.map(([, content]) => PlanningInvocation.parse(JSON.parse(content)));
	return invocations.filter((invocation) => invocation.workId === workId).sort((a, b) => b.sequence - a.sequence)[0];
};
