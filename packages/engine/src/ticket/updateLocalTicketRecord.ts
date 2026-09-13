import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { TicketRecord } from '#src/contracts/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import { getTicketFolderPath } from '#src/ticket/common/utils/getTicketFolderPath.ts';
import { readTicketRecordFile } from '#src/ticket/common/utils/readTicketRecordFile.ts';
import { serializeTicketRecord } from '#src/ticket/common/utils/serializeTicketRecord.ts';
import { withTicketRecordLock } from '#src/ticket/common/utils/withTicketRecordLock.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The ticket folder's name, which the changed record must also name as its branch. */
	ticketBranch: string;
	/** A pure function over the record as it is now. Tracker calls and gate runs happen before or after this call, never inside it — the lock is held for the whole of it. */
	change: (current: TicketRecord | undefined) => TicketRecord | { error: string };
}

/** The one thing a field schema cannot state: an event already recorded is never dropped or rewritten. */
const findHistoryRefusal = ({ current, next }: { current: TicketRecord | undefined; next: TicketRecord }) => {
	const recorded = current?.history ?? [];
	const kept = next.history.slice(0, recorded.length);
	const dropped = recorded.length > next.history.length;
	const rewritten = recorded.some((event, index) => canonicalJson({ value: event }) !== canonicalJson({ value: kept[index] }));

	return dropped || rewritten
		? `a ticket record's history is append-only, and the change to ${next.branch} drops or rewrites one of the ${recorded.length} events already recorded`
		: undefined;
};

/** Write the changed record, or say why it was refused. Nothing reaches disk until every rule has passed. */
const writeChangedRecord = async ({
	ticketFolder,
	recordPath,
	ticketBranch,
	current,
	changed,
}: {
	ticketFolder: string;
	recordPath: string;
	ticketBranch: string;
	current: TicketRecord | undefined;
	changed: TicketRecord;
}) => {
	const parsed = TicketRecord.safeParse(changed);
	let outcome: { record: TicketRecord } | { error: string };

	if (!parsed.success) {
		outcome = { error: `the changed ticket record for ${ticketBranch} does not match the ticket record contract: ${z.prettifyError(parsed.error)}` };
	} else if (parsed.data.branch !== ticketBranch) {
		outcome = { error: `the changed ticket record names branch '${parsed.data.branch}', not the '${ticketBranch}' ticket it was asked for` };
	} else {
		outcome = { record: parsed.data };
	}

	if ('record' in outcome) {
		const refusal = findHistoryRefusal({ current, next: outcome.record });

		outcome = refusal === undefined ? outcome : { error: refusal };
	}

	if ('record' in outcome) {
		const temporaryPath = join(ticketFolder, `${ticketFileNames.record}.${randomUUID()}.tmp`);

		try {
			await writeFile(temporaryPath, serializeTicketRecord({ record: outcome.record }));
			await rename(temporaryPath, recordPath);
		} catch (error) {
			outcome = { error: `the ticket record ${recordPath} could not be written: ${messageOf({ error })}` };
		}
	}

	return outcome;
};

/**
 * The one local writer of a ticket record's content: read, change, check,
 * write — all of it under the record's exclusive lock, so two commands on one
 * machine never lose each other's work.
 *
 * It enforces what belongs to the store and nothing more: the contract, that
 * the record names the ticket it was asked for, and the append-only history.
 * Which progress may follow which, and when a ship request is withdrawn, belong
 * to the operations that pass themselves in as `change`.
 *
 * The write is atomic — a temporary file beside the record, then a rename — for
 * the reason `writeBranchState` is, with one difference: a failed write is an
 * error handed back to the caller rather than a progress line, because the
 * caller's change has then not happened.
 */
export const updateLocalTicketRecord = async ({ cwd, ticketBranch, change }: Params): Promise<{ record: TicketRecord } | { error: string }> => {
	const stateDir = await resolveSharedStateDir({ cwd });
	const ticketFolder = getTicketFolderPath({ stateDir, ticketBranch });
	const recordPath = join(ticketFolder, ticketFileNames.record);

	return withTicketRecordLock({
		ticketFolder,
		run: async () => {
			const read = await readTicketRecordFile({ recordPath, ticketBranch });

			if ('error' in read) {
				return read;
			}

			const changed = change(read.record);

			return 'error' in changed ? changed : writeChangedRecord({ ticketFolder, recordPath, ticketBranch, current: read.record, changed });
		},
	});
};
