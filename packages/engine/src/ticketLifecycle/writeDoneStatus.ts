import { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';
import type { LifecycleSettings } from '#src/ticketLifecycle/common/types/LifecycleSettings.ts';
import { updateTicketLifecycle } from '#src/ticketLifecycle/updateTicketLifecycle.ts';
import { getTicketsByIdentifiers, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The resolved lifecycle settings — label names and status names, defaults applied. */
	lifecycle: LifecycleSettings;
	trackerSettings: TrackerSettings;
	ticketId: string;
	/** The identifier the ticket is read back by when the first write does not answer. */
	ticketRef: string;
	/** The status the ticket held when the caller read it. */
	currentStatus: string | undefined;
}

/**
 * Move a ticket to Done and find out whether it got there, rather than trusting
 * the first answer.
 *
 * The tracker call has a deadline, and a blown deadline cancels nothing: the
 * request is still on its way to the tracker, so a write reported as failed may
 * have landed a moment later. This is why the merge on LO-79 completed with its
 * ticket left open — the engine stopped listening and nobody ever asked.
 *
 * So a failure is answered by reading the ticket back, not by trying again
 * blind. Already Done means the write landed and there is nothing to do; only a
 * ticket that genuinely did not move is written a second time. That makes this
 * a converge on a known state rather than a retry, which matters because a
 * status write is not free to repeat — Jira refuses a self-transition its
 * workflow does not offer, and a blind second write would turn that refusal
 * into the reported error.
 *
 * The status comparison is exact, matching `updateTicketLifecycle`'s own. A
 * second, looser rule here would mean two answers in the codebase to the
 * question of whether a ticket is already at a status.
 *
 * @returns undefined when the ticket reads Done, or the reason it does not — a
 * fragment the caller puts in its own sentence, since only the caller knows
 * what else it has already reported.
 */
export const writeDoneStatus = async ({ lifecycle, trackerSettings, ticketId, ticketRef, currentStatus }: Params): Promise<string | undefined> => {
	const failure = await updateTicketLifecycle({ lifecycle, trackerSettings, ticketId, trackerStatus: TrackerStatusRole.Done, currentStatus });

	if (failure === undefined) {
		return undefined;
	}

	const found = await getTicketsByIdentifiers({ settings: trackerSettings, identifiers: [ticketRef] });

	if ('error' in found) {
		return `${failure.error} (and it could not be read back to check: ${found.error})`;
	}

	const status = found[0]?.status;

	if (status === lifecycle.statusNames[TrackerStatusRole.Done]) {
		return undefined;
	}

	const second = await updateTicketLifecycle({ lifecycle, trackerSettings, ticketId, trackerStatus: TrackerStatusRole.Done, currentStatus: status });

	return second?.error;
};
