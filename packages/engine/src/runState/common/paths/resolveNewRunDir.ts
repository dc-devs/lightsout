import { join } from 'node:path';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import { getCommandRunsDir } from '#src/runState/common/paths/getCommandRunsDir.ts';
import { getWorkOrderRunsDir } from '#src/runState/common/paths/getWorkOrderRunsDir.ts';

interface Params {
	cwd: string;
	/** The plan this run belongs to: an address `<ticket-branch>/<plan-id>`, or a legacy folder's bare slug. Absent on a run that belongs to no plan. */
	planName?: string;
	/** The ticket branch a plan-less run is built on. Absent on a run with no ticket to file under either. */
	workOrderName?: string;
	/** The pipeline that owns the run. An absent one reads as implement, matching what an absent discriminator already means on a manifest. */
	pipeline?: PipelineKind;
	runId: string;
}

/**
 * Where a NEW run goes, from what the caller already knows.
 *
 * A `planName` answers that plan's ticket folder's runs folder — the ticket
 * branch being whichever folder `workOrderNameOf` reads the name into, since a
 * legacy bare-slug folder is a ticket folder named for its branch. A
 * `workOrderName` with no plan name answers that same folder reached from the
 * branch, which is how a direct run of a ticket is filed under the ticket it
 * builds. Neither answers the owning command's runs folder.
 *
 * A plan name wins if both arrive, because a plan's address names its ticket
 * too — the two inputs can never disagree.
 *
 * It shares `resolveRunDir`'s verb deliberately: both answer which directory,
 * and separating them by verb would suggest they differ in kind rather than in
 * whether the run exists yet. It creates nothing, for the same reason.
 */
export const resolveNewRunDir = async ({ cwd, planName, workOrderName, pipeline, runId }: Params): Promise<string> => {
	const ticket = planName === undefined ? workOrderName : workOrderNameOf({ name: planName });
	const runsDir =
		ticket === undefined
			? getCommandRunsDir({ stateDir: await resolveSharedStateDir({ cwd }), pipeline: pipeline ?? PipelineKind.Implement })
			: getWorkOrderRunsDir({ workOrderFolder: await workOrderFolderDir({ cwd, name: ticket }) });

	return join(runsDir, runId);
};
