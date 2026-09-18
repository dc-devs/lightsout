import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
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
 * The names one directory under the plans folder contributes: the address of
 * every plan subfolder it holds, or its own name when it holds none.
 */
const namesOf = async ({ cwd, folder }: { cwd: string; folder: string }) => {
	const children = await readdir(join(await plansDir({ cwd }), folder), { withFileTypes: true }).catch(() => []);
	const addresses = children
		.filter((child) => child.isDirectory())
		.map((child) => formatPlanAddress({ ticketBranch: folder, planId: child.name }))
		.filter((address) => parsePlanAddress({ name: address }) !== undefined);

	return addresses.length === 0 ? [folder] : addresses;
};

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
 * A ticket folder contributes one row per plan, named by that plan's address,
 * and no row of its own: the folder is where a ticket's plans live rather than a
 * plan itself, and each plan's own runs are what its row counts.
 *
 * @param cwd - the repo whose `.lightsout/plans/` is read; a missing folder is an empty list, since a fresh clone has none
 */
export const listPlanWorkspaces = async ({ cwd }: Params): Promise<PlanWorkspaceListing[]> => {
	const entries = await readdir(await plansDir({ cwd }), { withFileTypes: true }).catch(() => []);
	const runs = await listRuns({ cwd });
	const listings: PlanWorkspaceListing[] = [];

	for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
		for (const name of await namesOf({ cwd, folder: entry.name })) {
			const files = await readPlanWorkspaceFiles({ cwd, name });
			const gradeFile = files.others.get('grade.json');
			const { value } = await readPlanRecord({ cwd, file: gradeFile, schema: GradeReport });

			listings.push(buildPlanWorkspaceListing({ name, files, hasGrade: gradeFile !== undefined, grade: value?.grade, runs: matchPlanRuns({ name, runs }) }));
		}
	}

	return listings.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
};
