import { join } from 'node:path';
import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { TicketSyncState } from '#src/contracts/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';

interface Params {
	/** The ticket's folder in the primary checkout. */
	ticketFolder: string;
}

/**
 * What this machine last published or restored, or undefined when there is no
 * usable sidecar.
 *
 * Every way the file can fail — missing, unreadable, not JSON, off contract —
 * answers undefined, and every comparison reads undefined as "no base", which
 * makes a local and a published copy that differ a divergence. That is the safe
 * direction: the alternative would be silently overwriting one of them.
 */
export const readTicketSyncState = async ({ ticketFolder }: Params): Promise<TicketSyncState | undefined> =>
	readJsonFile({ path: join(ticketFolder, ticketFileNames.sync), schema: TicketSyncState });
