import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';
import type { LifecycleSettings } from '#src/ticketLifecycle/common/types/LifecycleSettings.ts';
import { setExclusiveLabel, setTicketStatus, type TrackerFailure, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The resolved lifecycle settings — label names and status names, defaults applied. */
	lifecycle: LifecycleSettings;
	trackerSettings: TrackerSettings;
	ticketId: string;
	/** The planning status to record, or undefined to leave the ticket's alone. */
	planningStatus?: PlanningStatus;
	/** The status role to move the ticket to, or undefined to leave it where it is. */
	trackerStatus?: TrackerStatusRole;
	/**
	 * The status the ticket holds right now, when the caller already read it.
	 * Given, the status write is skipped when it already equals the target.
	 */
	currentStatus?: string;
}

/**
 * The two lifecycle fields, written as one operation: which planning a ticket
 * still owes, and where its implementation stands.
 *
 * The lifecycle settings parameter is `lifecycle` rather than `settings`
 * because every caller holds a `TrackerSettings` at the same moment, and a bare
 * `settings` beside a `trackerSettings` reads as the tracker's.
 *
 * `trackerStatus` takes a role, never a status name. Turning a role into the
 * repository's own spelling happens here and only here, which is what keeps
 * every caller free of status strings.
 *
 * A ticket already at the target status is left alone rather than asked to move
 * to it. That is not an optimisation: a required write is asked for a status the
 * ticket may already hold — a resumed parked ticket is at In Progress by
 * construction — and Jira looks up an available transition and refuses when the
 * workflow offers no self-transition, which most do not. Treating that refusal
 * as success instead would swallow a genuinely misconfigured status name, which
 * is the thing these writes exist to surface.
 *
 * The planning label is written first because the status is the visible
 * ownership marker, and ownership is the last thing to become true.
 */
export const updateTicketLifecycle = async ({
	lifecycle,
	trackerSettings,
	ticketId,
	planningStatus,
	trackerStatus,
	currentStatus,
}: Params): Promise<TrackerFailure | undefined> => {
	let failure: TrackerFailure | undefined;

	if (planningStatus !== undefined) {
		failure = await setExclusiveLabel({
			settings: trackerSettings,
			ticketId,
			label: lifecycle.planningStatusLabels[planningStatus],
			groupLabels: Object.values(PlanningStatus).map((status) => lifecycle.planningStatusLabels[status]),
		});
	}

	// A ticket that entered In Progress while still claiming shaping is owed is
	// worse than one that moved nowhere, so a failed label write stops here.
	if (failure === undefined && trackerStatus !== undefined) {
		const statusName = lifecycle.statusNames[trackerStatus];

		if (currentStatus !== statusName) {
			failure = await setTicketStatus({ settings: trackerSettings, ticketId, statusName });
		}
	}

	return failure;
};
