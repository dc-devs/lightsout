import type { RunListing } from '#src/contracts/index.ts';
import { isRunInPlanWorkspace } from '#src/plan/index.ts';

interface Params {
	name: string;
	runs: RunListing[];
}

/**
 * The runs whose plan path sits inside this workspace, newest first.
 *
 * Which paths count is `isRunInPlanWorkspace`'s rule, stated once there because
 * adoption asks the same question of the same folder. `listRuns` already
 * returns newest first, so the given order is kept rather than re-sorted.
 */
export const matchPlanRuns = ({ name, runs }: Params): RunListing[] => runs.filter((run) => isRunInPlanWorkspace({ runPlan: run.plan, name }));
