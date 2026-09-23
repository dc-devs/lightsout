import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import { readWorkOrderTicketRef } from '#src/workOrder/index.ts';

interface Params {
	/** The checkout to read. For an isolated run that is the workspace it was just put on, never wherever the command was typed. */
	cwd: string;
}

/**
 * What names a run: the ticket reference the checkout's work order record
 * carries, falling back to the branch name and then to a placeholder.
 *
 * One ladder, climbed from both ends of a commit — `implement-direct`'s own run
 * label and the ticket half of a plan run's commit subject — so what a commit is
 * addressed by cannot drift between the two pipelines. It only labels, so a
 * branch no work order claims is named rather than refused, and the last rung is
 * `work` rather than `ticket`: most repositories have no tracker at all, and a
 * commit subject should not tell them otherwise.
 */
export const readRunLabel = async ({ cwd }: Params): Promise<string> =>
	(await readWorkOrderTicketRef({ cwd })) ?? (await readGitCurrentBranch({ cwd })) ?? 'work';
