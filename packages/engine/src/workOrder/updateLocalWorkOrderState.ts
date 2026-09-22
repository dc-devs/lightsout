import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { WorkOrderState } from '#src/contracts/index.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';
import { readWorkOrderStateFile } from '#src/workOrder/common/utils/readWorkOrderStateFile.ts';
import { serializeWorkOrderState } from '#src/workOrder/common/utils/serializeWorkOrderState.ts';
import { withWorkOrderStateLock } from '#src/workOrder/common/utils/withWorkOrderStateLock.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The work order's label, which the changed record must also name as its branch. */
	name: string;
	/** A pure function over the record as it is now. Tracker calls and gate runs happen before or after this call, never inside it — the lock is held for the whole of it. */
	change: (current: WorkOrderState | undefined) => WorkOrderState | { error: string };
}

/** The one thing a field schema cannot state: an event already recorded is never dropped or rewritten. */
const findHistoryRefusal = ({ current, next }: { current: WorkOrderState | undefined; next: WorkOrderState }) => {
	const recorded = current?.history ?? [];
	const kept = next.history.slice(0, recorded.length);
	const dropped = recorded.length > next.history.length;
	const rewritten = recorded.some((event, index) => canonicalJson({ value: event }) !== canonicalJson({ value: kept[index] }));

	return dropped || rewritten
		? `a work order state's history is append-only, and the change to ${next.branch} drops or rewrites one of the ${recorded.length} events already recorded`
		: undefined;
};

/** Write the changed record, or say why it was refused. Nothing reaches disk until every rule has passed. */
const writeChangedRecord = async ({
	workOrderFolder,
	recordPath,
	name,
	current,
	changed,
}: {
	workOrderFolder: string;
	recordPath: string;
	name: string;
	current: WorkOrderState | undefined;
	changed: WorkOrderState;
}) => {
	const parsed = WorkOrderState.safeParse(changed);
	let outcome: { record: WorkOrderState } | { error: string };

	if (!parsed.success) {
		outcome = { error: `the changed work order state for ${name} does not match the work-order state contract: ${z.prettifyError(parsed.error)}` };
	} else if (parsed.data.branch !== name) {
		outcome = { error: `the changed work order state names branch '${parsed.data.branch}', not the '${name}' ticket it was asked for` };
	} else {
		outcome = { record: parsed.data };
	}

	if ('record' in outcome) {
		const refusal = findHistoryRefusal({ current, next: outcome.record });

		outcome = refusal === undefined ? outcome : { error: refusal };
	}

	if ('record' in outcome) {
		const temporaryPath = join(workOrderFolder, `${workOrderFileNames.record}.${randomUUID()}.tmp`);

		try {
			await writeFile(temporaryPath, serializeWorkOrderState({ record: outcome.record }));
			await rename(temporaryPath, recordPath);
		} catch (error) {
			outcome = { error: `the work order state ${recordPath} could not be written: ${messageOf({ error })}` };
		}
	}

	return outcome;
};

/**
 * The one local writer of a work order state's content: read, change, check,
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
export const updateLocalWorkOrderState = async ({ cwd, name, change }: Params): Promise<{ record: WorkOrderState } | { error: string }> => {
	const workOrderFolder = await workOrderFolderDir({ cwd, name });
	const recordPath = join(workOrderFolder, workOrderFileNames.record);

	return withWorkOrderStateLock({
		workOrderFolder,
		run: async () => {
			const read = await readWorkOrderStateFile({ statePath: recordPath, name });

			if ('error' in read) {
				return read;
			}

			const changed = change(read.record);

			return 'error' in changed ? changed : writeChangedRecord({ workOrderFolder, recordPath, name, current: read.record, changed });
		},
	});
};
