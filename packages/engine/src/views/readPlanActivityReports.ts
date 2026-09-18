import { buildActivityTree, readActivityMarks } from '#src/activity/index.ts';
import { planWorkspaceDir } from '#src/plan/index.ts';
import type { PlanActivityReport } from '#src/views/common/types/PlanActivityReport.ts';

interface Params {
	cwd: string;
	/** Plan names already resolved — a plan address, or a legacy plan folder's name. */
	names: string[];
}

/**
 * The data half of a plan report: plan names in, totalled trees out, nothing
 * printed.
 *
 * A plan folder holding no activity record answers an entry whose `report` is
 * absent rather than failing the read for the plan beside it — a list is an
 * account of what is there, the bargain `listPlanWorkspaces` strikes for a
 * workspace whose grade file will not parse. A folder whose record is partly
 * written answers a tree built from the marks that parsed, because a record cut
 * off when its process was killed still proves everything above the cut.
 *
 * Order follows the given names.
 *
 * It lives here rather than in the CLI for the reason every other reader in
 * this folder does: the web app reads this module, and a calculation the
 * terminal owns is one a second surface has to repeat. It takes resolved names
 * rather than a raw `--plan` value, so the CLI's name-resolution rules stay in
 * the CLI.
 */
export const readPlanActivityReports = async ({ cwd, names }: Params): Promise<PlanActivityReport[]> => {
	const reports: PlanActivityReport[] = [];

	for (const name of names) {
		const marks = await readActivityMarks({ dir: await planWorkspaceDir({ cwd, name }) });

		reports.push({ name, report: marks.length === 0 ? undefined : buildActivityTree({ plan: name, marks }) });
	}

	return reports;
};
