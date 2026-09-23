import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkOrderRecordFile } from '#src/common/workspace/readWorkOrderRecordFile.ts';
import { workOrdersDir } from '#src/common/workspace/workOrdersDir.ts';
import type { WorkOrderListing } from '#src/workOrder/index.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

/**
 * The work order a branch belongs to, found by reading the records rather than
 * by deriving anything from the branch string.
 *
 * It answers the listing — the folder's label and the record it holds — rather
 * than the label alone, because a caller that wants a field off that record
 * would otherwise open and parse the very file this look-up just parsed.
 *
 * The comparison is exact: never case-folded, never slugged, never matched
 * against a pattern. Folders are walked in sorted order, so two records naming
 * one branch always answer the same way — that is a hand-repair case, because a
 * record's branch is written once at creation and never again.
 *
 * There is deliberately no cached index. An index would be a second copy of the
 * truth, which is the defect the record exists to remove, and reading a few
 * dozen small JSON files is milliseconds.
 */
export const findWorkOrderForBranch = async ({ cwd, branch }: Params): Promise<WorkOrderListing | undefined> => {
	const folder = await workOrdersDir({ cwd });
	const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
	const names = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((first, second) => first.localeCompare(second));
	let found: WorkOrderListing | undefined;

	for (const name of names) {
		const record = await readWorkOrderRecordFile({ workOrderFolder: join(folder, name) });

		if (record?.branch === branch) {
			found = { name, record };
			break;
		}
	}

	return found;
};
