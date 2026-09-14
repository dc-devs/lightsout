import { join } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import type { TicketRecord } from '#src/contracts/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import { getTicketFolderPath } from '#src/ticket/common/utils/getTicketFolderPath.ts';
import { readTicketRecordFile } from '#src/ticket/common/utils/readTicketRecordFile.ts';

interface Params {
	/** Any checkout of the repository — the primary one, or a linked worktree. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
}

/**
 * One ticket's record, read from the primary checkout however many worktrees
 * this machine has.
 *
 * No lock is taken: the store writes by rename, so a reader never meets a
 * half-written file. `{ record: undefined }` says only that no `ticket.json`
 * exists, which every caller reads as "this is a legacy plan folder" — a
 * corrupt record is an error instead, never undefined.
 */
export const readTicketRecord = async ({ cwd, ticketBranch }: Params): Promise<{ record: TicketRecord | undefined } | { error: string }> => {
	const stateDir = await resolveSharedStateDir({ cwd });
	const ticketFolder = getTicketFolderPath({ stateDir, ticketBranch });

	return readTicketRecordFile({ recordPath: join(ticketFolder, ticketFileNames.record), ticketBranch });
};
