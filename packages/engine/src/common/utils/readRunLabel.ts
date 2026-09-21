import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { readBranchTicketRef } from '#src/ship/index.ts';

interface Params {
	/** The checkout to read. For an isolated run that is the workspace it was just put on, never wherever the command was typed. */
	cwd: string;
	config: LightsoutConfig;
}

/**
 * What names a run when no ticket record does: the branch's ticket reference,
 * falling back to the branch name and then to a placeholder.
 *
 * One ladder, climbed from both ends of a commit — `implement-direct`'s own run
 * label and the ticket half of a plan run's commit subject — so what a commit is
 * addressed by cannot drift between the two pipelines. It only labels, so a
 * branch the ship pattern cannot read is named rather than refused.
 */
export const readRunLabel = async ({ cwd, config }: Params): Promise<string> =>
	(await readBranchTicketRef({ config, cwd })) ?? (await readGitCurrentBranch({ cwd })) ?? 'ticket';
