import { join } from 'node:path';
import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { WorkOrderSyncState } from '#src/contracts/index.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';

interface Params {
	/** The work order's folder in the primary checkout. */
	workOrderFolder: string;
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
export const readWorkOrderSyncState = async ({ workOrderFolder }: Params): Promise<WorkOrderSyncState | undefined> =>
	readJsonFile({ path: join(workOrderFolder, workOrderFileNames.sync), schema: WorkOrderSyncState });
