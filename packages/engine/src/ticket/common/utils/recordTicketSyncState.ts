import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import { updateTicketSyncState } from '#src/ticket/common/utils/updateTicketSyncState.ts';
import { withTicketRecordLock } from '#src/ticket/common/utils/withTicketRecordLock.ts';

interface Params {
	/** The ticket's folder in the primary checkout — the sidecar is written beside the record there. */
	ticketFolder: string;
	/** SHA-256 of the record bytes this machine has just published or taken. */
	recordSha256?: string;
	/** Per plan id, the SHA-256 of the marker this machine has just published or restored. */
	planMarkers?: Record<string, string>;
	/** The first half of the one sentence a failed write answers with — what had already succeeded when it failed. */
	failure: string;
	/** Set when a surfaced `ticket.published.json` has been settled and must go once the sidecar is written. */
	dropSurfacedCopy?: boolean;
}

/**
 * Write what this machine has just published or taken into the sync sidecar,
 * under the record's lock, and answer one sentence when that could not be done.
 *
 * Every caller reaches the sidecar through here, so the lock discipline is got
 * right once rather than at each of them, and the sentence a human reads after
 * a failed write has one spelling per situation instead of one per call site.
 *
 * A failure is never the whole command's failure: the bytes are already on the
 * ticket or already on disk by the time this runs, and what is lost is only this
 * machine's memory of it — which the next `lightsout ticket sync` rebuilds.
 */
export const recordTicketSyncState = async ({
	ticketFolder,
	recordSha256,
	planMarkers,
	failure,
	dropSurfacedCopy,
}: Params): Promise<{ error: string } | undefined> => {
	const recorded = await withTicketRecordLock({
		ticketFolder,
		run: async (): Promise<{ error: string } | undefined> => {
			try {
				await updateTicketSyncState({ ticketFolder, recordSha256, planMarkers });

				if (dropSurfacedCopy === true) {
					await rm(join(ticketFolder, ticketFileNames.published), { force: true });
				}

				return undefined;
			} catch (error) {
				return { error: `${failure}: ${messageOf({ error })}` };
			}
		},
	});

	return recorded;
};
