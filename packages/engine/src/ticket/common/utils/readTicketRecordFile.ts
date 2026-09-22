import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { WorkOrderState } from '#src/contracts/index.ts';

interface Params {
	/** The `ticket.json` path in the primary checkout's ticket folder. */
	recordPath: string;
	/** The ticket folder's name, which the record must name as its branch. */
	ticketBranch: string;
}

/** The bytes at the record's path, the absence of the file, or why neither could be established. */
const readText = async ({ recordPath }: { recordPath: string }) => {
	let outcome: { text: string } | { missing: true } | { error: string };

	try {
		outcome = { text: await readFile(recordPath, 'utf8') };
	} catch (error) {
		const missing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

		outcome = missing ? { missing: true } : { error: `the ticket record ${recordPath} could not be read: ${messageOf({ error })}` };
	}

	return outcome;
};

/** Whatever the file held, read as a record of this ticket — or the one sentence saying why it is not one. */
const readRecordText = ({ text, recordPath, ticketBranch }: { text: string; recordPath: string; ticketBranch: string }) => {
	let value: unknown;
	let outcome: { record: WorkOrderState } | { error: string } | undefined;

	try {
		value = JSON.parse(text);
	} catch (error) {
		outcome = { error: `the ticket record ${recordPath} is not valid JSON: ${messageOf({ error })}` };
	}

	if (outcome === undefined) {
		const parsed = WorkOrderState.safeParse(value);

		if (!parsed.success) {
			outcome = { error: `the ticket record ${recordPath} does not match the ticket record contract: ${z.prettifyError(parsed.error)}` };
		} else if (parsed.data.branch !== ticketBranch) {
			outcome = { error: `the ticket record ${recordPath} names branch '${parsed.data.branch}', not the '${ticketBranch}' folder it sits in` };
		} else {
			outcome = { record: parsed.data };
		}
	}

	return outcome;
};

/**
 * Read one ticket's record from a path already resolved to the primary
 * checkout.
 *
 * Shared by `readTicketRecord`, which reads outside the lock, and
 * `updateLocalTicketRecord`, which reads inside it, so both apply exactly the
 * same rules to the same file.
 *
 * A missing file answers `{ record: undefined }` and nothing else does: every
 * other reader takes undefined to mean the folder is a legacy plan folder, so a
 * corrupt record, one the contract refuses, or one naming another branch has to
 * be an error naming the file rather than an invitation to treat a ticket's
 * plans as a single legacy folder.
 */
export const readTicketRecordFile = async ({ recordPath, ticketBranch }: Params): Promise<{ record: WorkOrderState | undefined } | { error: string }> => {
	const read = await readText({ recordPath });
	let outcome: { record: WorkOrderState | undefined } | { error: string };

	if ('error' in read) {
		outcome = read;
	} else if ('missing' in read) {
		outcome = { record: undefined };
	} else {
		outcome = readRecordText({ text: read.text, recordPath, ticketBranch });
	}

	return outcome;
};
