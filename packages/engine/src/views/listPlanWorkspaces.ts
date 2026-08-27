import { readdir } from 'node:fs/promises';
import { GradeReport, type PlanWorkspaceListing } from '#src/contracts/index.ts';
import { plansDir } from '#src/plan/index.ts';
import { buildPlanWorkspaceListing } from '#src/views/common/utils/buildPlanWorkspaceListing.ts';
import { matchPlanRuns } from '#src/views/common/utils/matchPlanRuns.ts';
import { readPlanRecord } from '#src/views/common/utils/readPlanRecord.ts';
import { readPlanWorkspaceFiles } from '#src/views/common/utils/readPlanWorkspaceFiles.ts';
import { listRuns } from '#src/views/listRuns.ts';

interface Params {
	cwd: string;
}

/**
 * Every plan workspace this repo has, newest first.
 *
 * Stats each workspace and parses one file — `grade.json`, because the grade is
 * a column. Eighteen workspaces of up to eleven files each is not a reason to
 * open them all to draw a table, which is the bargain `listRuns` strikes too.
 *
 * A workspace whose `grade.json` will not parse is listed without a grade rather
 * than skipped: a list is an account of what is there.
 *
 * @param cwd - the repo whose `.lightsout/plans/` is read; a missing folder is an empty list, since a fresh clone has none
 */
export const listPlanWorkspaces = async ({ cwd }: Params): Promise<PlanWorkspaceListing[]> => {
	const entries = await readdir(plansDir({ cwd }), { withFileTypes: true }).catch(() => []);
	const runs = await listRuns({ cwd });
	const listings: PlanWorkspaceListing[] = [];

	for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
		const name = entry.name;
		const files = await readPlanWorkspaceFiles({ cwd, name });
		const gradeFile = files.others.get('grade.json');
		const { value } = await readPlanRecord({ cwd, file: gradeFile, schema: GradeReport });

		listings.push(buildPlanWorkspaceListing({ name, files, hasGrade: gradeFile !== undefined, grade: value?.grade, runs: matchPlanRuns({ name, runs }) }));
	}

	return listings.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
};
