import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import { writeTicketFolderFile } from '#src/ticket/common/utils/writeTicketFolderFile.ts';

interface Params {
	/** The ticket's folder in the primary checkout. The caller holds its lock. */
	ticketFolder: string;
	/** The ticket folder's name, spelled into the resolving command. */
	ticketBranch: string;
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
export const surfaceTicketDivergence = async ({ ticketFolder, ticketBranch, ticketRef, content }: Params): Promise<string> => {
	const sync = `lightsout ticket sync --name ${ticketBranch}`;
	let saved = `the published copy is saved beside it as ${ticketFileNames.published}`;

	try {
		await writeTicketFolderFile({ path: join(ticketFolder, ticketFileNames.published), content });
	} catch (error) {
		saved = `the published copy could not be saved as ${ticketFileNames.published} (${messageOf({ error })})`;
	}

	return `the ticket record for '${ticketBranch}' moved both here and on ${ticketRef} since this machine last synced — ${saved}; run \`${sync} --keep local\` to publish this machine's copy over it, or \`${sync} --keep published\` to take the ticket's copy instead`;
};
