import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import { readWorkOrderRecordFile } from '#src/common/workspace/readWorkOrderRecordFile.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';

interface Params {
	/** Any checkout of the repository; the record is found in its primary checkout. */
	cwd: string;
	/** A plan address, or a work order's label on its own. */
	name: string;
}

/**
 * The ticket a plan's work order belongs to, read out of that work order's own
 * record — or undefined when the work order belongs to no ticket, or there is
 * no readable record at all.
 *
 * Nothing reads a ticket id out of a name here any more, which is what removes
 * the false positive the old reader carried: a label like `phase-2-cleanup` no
 * longer reads as ticket `phase-2`, because a label is only a label and
 * `ticketRef` is the one field that answers which ticket the work belongs to.
 */
export const readPlanWorkOrderRef = async ({ cwd, name }: Params): Promise<string | undefined> => {
	const record = await readWorkOrderRecordFile({ workOrderFolder: await workOrderFolderDir({ cwd, name: workOrderNameOf({ name }) }) });

	return record?.ticketRef;
};
