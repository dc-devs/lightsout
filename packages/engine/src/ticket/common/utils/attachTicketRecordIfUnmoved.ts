import { sha256 } from '#src/common/utils/sha256.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import type { TicketTrackerTarget } from '#src/ticket/common/types/TicketTrackerTarget.ts';
import { getTicketFolderPath } from '#src/ticket/common/utils/getTicketFolderPath.ts';
import { readPublishedTicketRecord } from '#src/ticket/common/utils/readPublishedTicketRecord.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { serializeTicketRecord } from '#src/ticket/common/utils/serializeTicketRecord.ts';
import { surfaceTicketDivergence } from '#src/ticket/common/utils/surfaceTicketDivergence.ts';
import { withTicketRecordLock } from '#src/ticket/common/utils/withTicketRecordLock.ts';
import { readTicketRecord } from '#src/ticket/readTicketRecord.ts';
import { getTicketsByIdentifiers, setTicketAttachment } from '#src/ticketTracker/index.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	ticketBranch: string;
	target: TicketTrackerTarget;
	/** The hash of the published copy the caller last read, or undefined when the ticket carried none. */
	expectedPublishedSha256: string | undefined;
	onProgress?: (message: string) => void;
}

interface AttachParams {
	target: TicketTrackerTarget;
	/** The record's bytes, exactly as `serializeTicketRecord` wrote them. */
	content: Buffer;
	onProgress?: (message: string) => void;
}

/**
 * Put the record on the ticket, or answer the one sentence saying why it did
 * not land.
 *
 * `setTicketAttachment` replaces a same-titled attachment, so the ticket never
 * ends up carrying two records this wrote. It stays private to this file
 * because the guard above it is the whole point: an unguarded attach would
 * overwrite a record another machine published since the pull.
 */
const attachTicketRecord = async ({ target, content, onProgress }: AttachParams): Promise<{ error: string } | undefined> => {
	const { settings, ticketRef } = target;
	const tickets = await getTicketsByIdentifiers({ settings, identifiers: [ticketRef] });

	if ('error' in tickets) {
		return { error: `the ticket record could not be published: ${tickets.error}` };
	}

	const ticket = tickets.at(0);

	if (ticket === undefined) {
		return { error: `the ticket record could not be published: there is no ${ticketRef} on the configured ticket tracker` };
	}

	const failure = await setTicketAttachment({ settings, ticketId: ticket.id, title: ticketFileNames.record, content, contentType: 'application/json' });

	if (failure !== undefined) {
		return { error: `the ticket record could not be published: ${failure.error}` };
	}

	onProgress?.(`attached ${ticketFileNames.record} to ${ticketRef}`);

	return undefined;
};

/**
 * The one guarded upload of a ticket record: re-read what the ticket carries,
 * and attach only when nothing another machine wrote would be lost.
 *
 * The trackers offer no compare-and-swap, so a pull followed by an attach
 * silently overwrites a record published in between — and that machine's next
 * pull would then take this copy over its own change. Re-reading immediately
 * before the attach narrows the window to the attach call itself.
 *
 * What is uploaded is the local record as it stands NOW, read here rather than
 * taken from the caller: local writes are serialized by the record's lock and
 * each one includes every earlier one, so sending the newest is what stops a
 * second command on this machine being undone by an older copy in flight.
 *
 * Three published hashes are accepted beside "the ticket carries none": the one
 * the caller read, the one the sidecar currently names (this machine published
 * those bytes, so a same-machine publish is never another machine's change),
 * and the bytes about to be sent.
 */
export const attachTicketRecordIfUnmoved = async ({
	cwd,
	ticketBranch,
	target,
	expectedPublishedSha256,
	onProgress,
}: Params): Promise<{ attachedSha256: string } | { error: string }> => {
	const published = await readPublishedTicketRecord({ target, ticketBranch });

	if ('error' in published) {
		return published;
	}

	const local = await readTicketRecord({ cwd, ticketBranch });

	if ('error' in local) {
		return local;
	}

	if (local.record === undefined) {
		return { error: `there is no ${ticketFileNames.record} for '${ticketBranch}' on this machine to publish` };
	}

	const stateDir = await resolveSharedStateDir({ cwd });
	const ticketFolder = getTicketFolderPath({ stateDir, ticketBranch });
	const syncState = await readTicketSyncState({ ticketFolder });
	const content = serializeTicketRecord({ record: local.record });
	const attachedSha256 = sha256({ content });
	const carried = published.published;
	const publishedSha256 = carried === undefined ? undefined : sha256({ content: carried.content });
	const moved = publishedSha256 !== expectedPublishedSha256 && publishedSha256 !== syncState?.recordSha256 && publishedSha256 !== attachedSha256;

	if (carried !== undefined && moved) {
		const surfaced = await withTicketRecordLock({
			ticketFolder,
			run: () => surfaceTicketDivergence({ ticketFolder, ticketBranch, ticketRef: target.ticketRef, content: carried.content }),
		});

		return { error: typeof surfaced === 'string' ? surfaced : surfaced.error };
	}

	const failure = await attachTicketRecord({ target, content, onProgress });

	return failure ?? { attachedSha256 };
};
