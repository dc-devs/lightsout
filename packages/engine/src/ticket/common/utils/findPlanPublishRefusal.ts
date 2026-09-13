import { PlanProgress, type TicketRecord, type TicketSyncState } from '#src/contracts/index.ts';
import { findDivergentPlanIds } from '#src/ticket/common/utils/findDivergentPlanIds.ts';
import { matchesImplementedSnapshot } from '#src/ticket/common/utils/matchesImplementedSnapshot.ts';

interface Params {
	cwd: string;
	/** The plan's address, `<ticket-branch>/<plan-id>`. */
	address: string;
	planId: string;
	ticketBranch: string;
	/** The record as the pull left it, or none at all. */
	record: TicketRecord | undefined;
	/** What this machine last published or restored, which is how a plan republished elsewhere is spotted. */
	syncState: TicketSyncState | undefined;
}

/**
 * Every refusal that has to be settled before the first attachment goes out.
 *
 * All three are read from the record and the sidecar alone, so a plan the
 * ticket does not hold, one another machine has republished, and one whose
 * implemented scope no longer matches its files each cost nothing to catch.
 */
export const findPlanPublishRefusal = async ({ cwd, address, planId, ticketBranch, record, syncState }: Params): Promise<string | undefined> => {
	const plan = record?.plans.find((entry) => entry.id === planId);

	if (record === undefined || plan === undefined) {
		return `the ticket record for '${ticketBranch}' does not hold plan ${planId} — run \`lightsout ticket add-plan --name ${ticketBranch} --slug <slug>\` to add a plan before publishing it`;
	}

	if (findDivergentPlanIds({ record, syncState }).includes(planId)) {
		return `plan ${planId} was published from another machine after this one last saw it, so publishing over it would lose that work — run \`lightsout ticket sync --name ${ticketBranch} --keep local\` to send this machine's copy, or \`--keep published\` to take the ticket's`;
	}

	const snapshot = plan.implementation?.snapshot;

	if (plan.progress === PlanProgress.Implemented && snapshot !== undefined && !(await matchesImplementedSnapshot({ cwd, address, snapshot }))) {
		return `plan ${planId} is implemented and its files have changed since the run that implemented it, so it no longer describes what was built — run \`lightsout ticket add-plan --name ${ticketBranch} --slug <slug>\` and put the follow-up work in a plan of its own`;
	}

	return undefined;
};
