import { join } from 'node:path';
import { ticketFolderOf } from '#src/common/planAddress/ticketFolderOf.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { ticketFolderDir } from '#src/common/workspace/ticketFolderDir.ts';
import { PipelineKind } from '#src/contracts/index.ts';
import { getCommandRunsDir } from '#src/runState/common/paths/getCommandRunsDir.ts';
import { getTicketRunsDir } from '#src/runState/common/paths/getTicketRunsDir.ts';

interface Params {
	cwd: string;
	/** The plan this run belongs to: an address `<ticket-branch>/<plan-id>`, or a legacy folder's bare slug. Absent on a run that belongs to no plan. */
	planName?: string;
	/** The ticket branch a plan-less run is built on. Absent on a run with no ticket to file under either. */
	ticketBranch?: string;
	/** The pipeline that owns the run. An absent one reads as implement, matching what an absent discriminator already means on a manifest. */
	pipeline?: PipelineKind;
	runId: string;
}

/**
 * Where a NEW run goes, from what the caller already knows.
 *
 * A `planName` answers that plan's ticket folder's runs folder — the ticket
 * branch being whichever folder `ticketFolderOf` reads the name into, since a
 * legacy bare-slug folder is a ticket folder named for its branch. A
 * `ticketBranch` with no plan name answers that same folder reached from the
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
export const resolveNewRunDir = async ({ cwd, planName, ticketBranch, pipeline, runId }: Params): Promise<string> => {
	const ticket = planName === undefined ? ticketBranch : ticketFolderOf({ name: planName });
	const runsDir =
		ticket === undefined
			? getCommandRunsDir({ stateDir: await resolveSharedStateDir({ cwd }), pipeline: pipeline ?? PipelineKind.Implement })
			: getTicketRunsDir({ ticketFolder: await ticketFolderDir({ cwd, ticketBranch: ticket }) });

	return join(runsDir, runId);
};
