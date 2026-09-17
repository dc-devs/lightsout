import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { PlanningProgress } from '#src/contracts/index.ts';
import { getPlanningProgressPath } from '#src/plan/progress/getPlanningProgressPath.ts';

interface Params {
	cwd: string;
	name: string;
}

/**
 * The planning record a plan folder holds, or undefined when none was ever
 * written, the file is not JSON, or its contents do not satisfy the contract.
 * Never throws: the record is a reader's convenience, and a reader asking about
 * a plan that recorded nothing has a normal answer.
 */
export const readPlanningProgress = async ({ cwd, name }: Params): Promise<PlanningProgress | undefined> => {
	return readJsonFile({ path: getPlanningProgressPath({ cwd, name }), schema: PlanningProgress });
};
