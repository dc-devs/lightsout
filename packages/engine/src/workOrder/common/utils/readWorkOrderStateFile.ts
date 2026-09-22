import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { WorkOrderState } from '#src/contracts/index.ts';

interface Params {
	/** The `state.json` path in the primary checkout's work order folder. */
	statePath: string;
	/** The work order's label, which the record must name as its branch. */
	name: string;
}

/** The bytes at the state file's path, the absence of the file, or why neither could be established. */
const readText = async ({ statePath }: { statePath: string }) => {
	let outcome: { text: string } | { missing: true } | { error: string };

	try {
		outcome = { text: await readFile(statePath, 'utf8') };
	} catch (error) {
		const missing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

		outcome = missing ? { missing: true } : { error: `the work order state ${statePath} could not be read: ${messageOf({ error })}` };
	}

	return outcome;
};

/** Whatever the file held, read as this work order's state — or the one sentence saying why it is not one. */
const readStateText = ({ text, statePath, name }: { text: string; statePath: string; name: string }) => {
	let value: unknown;
	let outcome: { record: WorkOrderState } | { error: string } | undefined;

	try {
		value = JSON.parse(text);
	} catch (error) {
		outcome = { error: `the work order state ${statePath} is not valid JSON: ${messageOf({ error })}` };
	}

	if (outcome === undefined) {
		const parsed = WorkOrderState.safeParse(value);

		if (!parsed.success) {
			outcome = { error: `the work order state ${statePath} does not match the work order state contract: ${z.prettifyError(parsed.error)}` };
		} else if (parsed.data.branch !== name) {
			outcome = { error: `the work order state ${statePath} names branch '${parsed.data.branch}', not the '${name}' folder it sits in` };
		} else {
			outcome = { record: parsed.data };
		}
	}

	return outcome;
};

/**
 * Read one work order's state from a path already resolved to the primary
 * checkout.
 *
 * Shared by `readWorkOrderState`, which reads outside the lock, and
 * `updateLocalWorkOrderState`, which reads inside it, so both apply exactly the
 * same rules to the same file.
 *
 * A missing file answers `{ record: undefined }` and nothing else does: every
 * other reader takes undefined to mean the folder is a legacy plan folder, so a
 * corrupt state file, one the contract refuses, or one naming another branch
 * has to be an error naming the file rather than an invitation to treat a work
 * order's plans as a single legacy folder.
 */
export const readWorkOrderStateFile = async ({ statePath, name }: Params): Promise<{ record: WorkOrderState | undefined } | { error: string }> => {
	const read = await readText({ statePath });
	let outcome: { record: WorkOrderState | undefined } | { error: string };

	if ('error' in read) {
		outcome = read;
	} else if ('missing' in read) {
		outcome = { record: undefined };
	} else {
		outcome = readStateText({ text: read.text, statePath, name });
	}

	return outcome;
};
