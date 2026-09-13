import { join } from 'node:path';

interface Params {
	/** The `.lightsout` directory of the PRIMARY checkout, resolved by the caller. */
	stateDir: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
}

/**
 * A ticket's own folder: `<stateDir>/plans/<ticketBranch>` — the same folder
 * `planWorkspaceDir` names for that branch in the primary checkout, holding the
 * ticket's record beside its plan subfolders.
 *
 * It takes the already-resolved state directory rather than a `cwd`, exactly as
 * `getWorktreeRecordPath` does: that is what makes "the record lives once per
 * machine, in the primary checkout" true by construction rather than by every
 * caller remembering.
 */
export const getTicketFolderPath = ({ stateDir, ticketBranch }: Params): string => join(stateDir, 'plans', ticketBranch);
