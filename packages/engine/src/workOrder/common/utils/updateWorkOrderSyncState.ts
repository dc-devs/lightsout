import { join } from 'node:path';
import type { WorkOrderSyncState } from '#src/contracts/workOrder/WorkOrderSyncState.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';
import { readWorkOrderSyncState } from '#src/workOrder/common/utils/readWorkOrderSyncState.ts';
import { writeWorkOrderFolderFile } from '#src/workOrder/common/utils/writeWorkOrderFolderFile.ts';

interface Params {
	/** The work order's folder in the primary checkout. */
	workOrderFolder: string;
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
export const updateWorkOrderSyncState = async ({ workOrderFolder, recordSha256, planMarkers }: Params): Promise<void> => {
	const current = await readWorkOrderSyncState({ workOrderFolder });
	const recorded = recordSha256 ?? current?.recordSha256;
	const next: WorkOrderSyncState = {
		schemaVersion: 1,
		planMarkers: { ...current?.planMarkers, ...planMarkers },
	};

	if (recorded !== undefined) {
		next.recordSha256 = recorded;
	}

	await writeWorkOrderFolderFile({
		path: join(workOrderFolder, workOrderFileNames.sync),
		content: Buffer.from(`${JSON.stringify(next, undefined, '\t')}\n`, 'utf8'),
	});
};
