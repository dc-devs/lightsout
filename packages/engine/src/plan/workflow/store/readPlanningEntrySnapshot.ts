import { hasPlanningWorkflow } from '#src/plan/common/paths/hasPlanningWorkflow.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/readPlanningSnapshot.ts';

interface Params {
	cwd: string;
	name: string;
}

/** Public entrypoints distinguish a never-started workspace from a damaged or incomplete new-format handoff. */
export const readPlanningEntrySnapshot = async ({ cwd, name }: Params): Promise<PlanningSnapshot | undefined> => {
	const snapshot = await readPlanningSnapshot({ cwd, name });
	if (!snapshot && (await hasPlanningWorkflow({ cwd, name })))
		throw new Error('New-format planning workspace is missing its canonical generation; restore the complete handoff before continuing');
	return snapshot;
};
