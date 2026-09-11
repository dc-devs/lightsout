import { rename } from 'node:fs/promises';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { PlanningProgress } from '#src/contracts/index.ts';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { getPlanningProgressPath } from '#src/plan/progress/getPlanningProgressPath.ts';

interface Params {
	cwd: string;
	progress: PlanningProgress;
}

/**
 * Persist a planning record atomically (tmp file + rename), or write nothing
 * when the plan folder does not exist.
 *
 * It never creates the plan folder: `ensurePlanWorkspace` and the brainstorm
 * fetch fetch from the ticket only when that folder is absent, so a record that
 * created it would change what planning does. A failed write rejects, and the
 * caller owns reporting it.
 */
export const writePlanningProgress = async ({ cwd, progress }: Params): Promise<void> => {
	if (!(await pathExists({ path: planWorkspaceDir({ cwd, name: progress.name }) }))) {
		return;
	}

	const recordPath = getPlanningProgressPath({ cwd, name: progress.name });
	const tmpPath = `${recordPath}.tmp`;

	await writeJsonFile({ path: tmpPath, value: progress });
	await rename(tmpPath, recordPath);
};
