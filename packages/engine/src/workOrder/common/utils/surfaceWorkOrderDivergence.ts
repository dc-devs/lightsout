import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';
import { writeWorkOrderFolderFile } from '#src/workOrder/common/utils/writeWorkOrderFolderFile.ts';

interface Params {
	/** The work order's folder in the primary checkout. The caller holds its lock. */
	workOrderFolder: string;
	/** The work order's label, spelled into the resolving command. */
	name: string;
	/** The ticket the published copy came from. */
	ticketRef: string;
	/** The published record's normalised bytes, saved beside the local record for the human to read. */
	content: Buffer;
}

/**
 * Save the published record beside the local one and answer the one sentence
 * that names the way out.
 *
 * Both places a divergence is found — the pull, and the guarded upload's own
 * re-read — end here, so the file a human is told to look at and the command
 * they are told to run are written once. Nothing is overwritten and nothing is
 * published: a divergence means both copies hold real work, and only a person
 * can say which one the ticket keeps.
 */
export const surfaceWorkOrderDivergence = async ({ workOrderFolder, name, ticketRef, content }: Params): Promise<string> => {
	const sync = `lightsout work-order sync --name ${name}`;
	let saved = `the published copy is saved beside it as ${workOrderFileNames.published}`;

	try {
		await writeWorkOrderFolderFile({ path: join(workOrderFolder, workOrderFileNames.published), content });
	} catch (error) {
		saved = `the published copy could not be saved as ${workOrderFileNames.published} (${messageOf({ error })})`;
	}

	return `the work order state for '${name}' moved both here and on ${ticketRef} since this machine last synced — ${saved}; run \`${sync} --keep local\` to publish this machine's copy over it, or \`${sync} --keep published\` to take the ticket's copy instead`;
};
