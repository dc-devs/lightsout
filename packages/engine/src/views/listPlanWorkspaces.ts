import { readdir } from 'node:fs/promises';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { workOrdersDir } from '#src/common/workspace/workOrdersDir.ts';
import { GradeReport } from '#src/contracts/plan/grade/GradeReport.ts';
import type { PlanWorkspaceListing } from '#src/contracts/views/planWorkspace/PlanWorkspaceListing.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { buildPlanWorkspaceListing } from '#src/views/internal/common/utils/buildPlanWorkspaceListing.ts';
import { matchPlanRuns } from '#src/views/internal/common/utils/matchPlanRuns.ts';
import { readPlanRecord } from '#src/views/internal/common/utils/readPlanRecord.ts';
import { readPlanWorkspaceFiles } from '#src/views/internal/common/utils/readPlanWorkspaceFiles.ts';
import { listRuns } from '#src/views/listRuns.ts';

interface Params {
	cwd: string;
}

/**
 * The names one ticket folder contributes: the address of every plan subfolder
 * its plans folder holds, or the ticket's own name when that folder is there
 * and holds none — which is the brainstorm shaped before a plan id existed.
 *
 * A ticket folder with no plans folder at all contributes nothing. Every branch
 * gets a folder for its ship and worktree records, so absent and empty are
 * different answers: absent means no plan was ever shaped here, and a row for
 * it would put a phantom plan named for the branch on the list.
 */
const namesOf = async ({ cwd, folder }: { cwd: string; folder: string }) => {
	const children = await readdir(await planWorkspaceDir({ cwd, name: folder }), { withFileTypes: true }).catch(() => undefined);

	if (children === undefined) {
		return [];
	}

	const addresses = children
		.filter((child) => child.isDirectory())
		.map((child) => formatPlanAddress({ workOrderName: folder, planId: child.name }))
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
 * @param cwd - the repo whose `.lightsout/work-orders/` is read; a missing folder is an empty list, since a fresh clone has none
 */
export const listPlanWorkspaces = async ({ cwd }: Params): Promise<PlanWorkspaceListing[]> => {
	const entries = await readdir(await workOrdersDir({ cwd }), { withFileTypes: true }).catch(() => []);
	const listings: PlanWorkspaceListing[] = [];

	for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
		// One read of this ticket's own runs folder, shared by its plans. A filter
		// over every run on disk would read the other tickets' runs to answer for
		// this one's.
		const runs = await listRuns({ cwd, workOrderName: entry.name });

		for (const name of await namesOf({ cwd, folder: entry.name })) {
			const files = await readPlanWorkspaceFiles({ cwd, name });
			const gradeFile = files.others.get('grade.json');
			const { value } = await readPlanRecord({ cwd, file: gradeFile, schema: GradeReport });

			listings.push(buildPlanWorkspaceListing({ name, files, hasGrade: gradeFile !== undefined, grade: value?.grade, runs: matchPlanRuns({ name, runs }) }));
		}
	}

	return listings.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
};
