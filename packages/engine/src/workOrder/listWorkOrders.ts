import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { workOrdersDir } from '#src/common/workspace/workOrdersDir.ts';
import type { WorkOrderListing } from '#src/workOrder/common/types/WorkOrderListing.ts';
import { workOrderFileNames } from '#src/workOrder/internal/common/constants/workOrderFileNames.ts';
import { readWorkOrderStateFile } from '#src/workOrder/internal/common/utils/readWorkOrderStateFile.ts';

interface Params {
	/** Any checkout of the repository: the records this machine holds are found from it. */
	cwd: string;
}

/**
 * Every work order this machine holds, read from the records themselves.
 *
 * A folder whose record is missing or will not parse is named in `unreadable`
 * rather than dropped. A read-only look-up ignores that list, because one bad
 * folder must not make every look-up fail; creation cannot, because a folder it
 * cannot read is a work order it cannot see — and an invisible work order is
 * how one ticket comes to have two, which is the one state the design says must
 * always be a refusal naming both.
 *
 * Both lists come back sorted by name, so two runs of the same command print
 * the same order.
 *
 * There is deliberately no cached index. An index would be a second copy of the
 * truth, which is the exact defect the record exists to remove, and reading a
 * few dozen small JSON files is milliseconds.
 */
export const listWorkOrders = async ({ cwd }: Params): Promise<{ found: WorkOrderListing[]; unreadable: string[] }> => {
	const folder = await workOrdersDir({ cwd });
	const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
	const found: WorkOrderListing[] = [];
	const unreadable: string[] = [];

	for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
		const read = await readWorkOrderStateFile({ statePath: join(folder, entry.name, workOrderFileNames.record), name: entry.name });

		if ('error' in read || read.record === undefined) {
			unreadable.push(entry.name);
		} else {
			found.push({ name: entry.name, record: read.record });
		}
	}

	return {
		found: found.sort((first, second) => first.name.localeCompare(second.name)),
		unreadable: unreadable.sort((first, second) => first.localeCompare(second)),
	};
};
