import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workOrderStateFileName } from '#src/common/constants/workOrderStateFileName.ts';
import { WorkOrderState } from '#src/contracts/index.ts';

interface Params {
	/** One work order's own folder under the work-orders directory. */
	workOrderFolder: string;
}

/**
 * One work order's record as the contract accepts it, or undefined when the
 * folder holds no record, holds one that is not JSON, or holds one the contract
 * refuses.
 *
 * It answers undefined rather than a sentence because both look-ups built on it
 * — which work order stores a branch, and which ticket a plan's work order
 * belongs to — are read-only questions a caller answers for itself. The work
 * order module's own `readWorkOrderStateFile` is the reader that reports WHY a
 * record could not be read, and it stays there: this lives under `common/`
 * because `ship` and `worktree` need it and are already imported by that
 * module, so importing it from there would close a cycle.
 */
export const readWorkOrderRecordFile = async ({ workOrderFolder }: Params): Promise<WorkOrderState | undefined> => {
	const text = await readFile(join(workOrderFolder, workOrderStateFileName), 'utf8').catch(() => undefined);

	if (text === undefined) {
		return undefined;
	}

	let value: unknown;

	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}

	const parsed = WorkOrderState.safeParse(value);

	return parsed.success ? parsed.data : undefined;
};
