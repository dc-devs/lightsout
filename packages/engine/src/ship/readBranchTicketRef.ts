import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { readTicketMatch } from '#src/ship/readTicketMatch.ts';
import { resolveShipSettings } from '#src/ship/resolveShipSettings.ts';

interface Params {
	config: LightsoutConfig;
	/** The checkout whose current branch is read. */
	cwd: string;
}

/**
 * The ticket reference the checkout's current branch carries, read through the
 * repository's own `ship.ticket-pattern`.
 *
 * It lives here because the pattern, the match and the branch read all belong to
 * ship, and because every caller that needs "which ticket is this checkout on?"
 * would otherwise assemble the same three steps for itself. A detached head, an
 * unusable pattern and a branch the pattern does not match all answer undefined:
 * the callers differ in what they do about that, not in how they find it out.
 *
 * @returns the branch's ticket reference, or undefined when the branch carries none
 */
export const readBranchTicketRef = async ({ config, cwd }: Params): Promise<string | undefined> => {
	const settings = resolveShipSettings({ config });
	const branch = await readGitCurrentBranch({ cwd });

	if (settings === undefined || branch === undefined) {
		return undefined;
	}

	return readTicketMatch({ branch, ticketPattern: settings.ticketPattern })?.ticket;
};
