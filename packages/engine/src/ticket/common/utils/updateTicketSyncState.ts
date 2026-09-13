import { join } from 'node:path';
import type { TicketSyncState } from '#src/contracts/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { writeTicketFolderFile } from '#src/ticket/common/utils/writeTicketFolderFile.ts';

interface Params {
	/** The ticket's folder in the primary checkout. */
	ticketFolder: string;
	/** The bytes of the record just published or restored, when this write records one. */
	recordSha256?: string;
	/** Marker hashes to merge in, key by key — a plan this call says nothing about keeps the hash it had. */
	planMarkers?: Record<string, string>;
}

/**
 * Record what this machine has just published or restored.
 *
 * Merging rather than replacing is the point: publishing one plan must not
 * forget what is known about another, and recording the record's own bytes must
 * not forget the plans. The caller holds the record's lock, so the read and the
 * write here cannot interleave with another writer's.
 *
 * A write failure throws, because a sidecar that did not land means the next
 * pull will call a record that is in fact in sync a divergence — the caller
 * decides whether that is a refusal or a progress line.
 */
export const updateTicketSyncState = async ({ ticketFolder, recordSha256, planMarkers }: Params): Promise<void> => {
	const current = await readTicketSyncState({ ticketFolder });
	const recorded = recordSha256 ?? current?.recordSha256;
	const next: TicketSyncState = {
		schemaVersion: 1,
		planMarkers: { ...current?.planMarkers, ...planMarkers },
	};

	if (recorded !== undefined) {
		next.recordSha256 = recorded;
	}

	await writeTicketFolderFile({
		path: join(ticketFolder, ticketFileNames.sync),
		content: Buffer.from(`${JSON.stringify(next, undefined, '\t')}\n`, 'utf8'),
	});
};
