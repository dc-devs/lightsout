import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import { findWorkOrderForBranch } from '#src/common/workspace/findWorkOrderForBranch.ts';

interface Params {
	/** The checkout whose current branch is read. */
	cwd: string;
}

/**
 * The ticket reference the checkout's current branch belongs to, read out of
 * the work order whose record stores that branch.
 *
 * It asks the record rather than the branch's own spelling, which is what lets
 * a branch carry a prefix, and a reference carry the tracker's own capitals,
 * without either being guessed at. A detached head, a branch no work order
 * claims, and a work order belonging to no ticket all answer undefined: the
 * callers differ in what they do about that, not in how they find it out.
 *
 * It lives in this module rather than in `ship` because it now reads a work
 * order, and `ship` may not import this module — the reverse edge already
 * exists, and closing it would be a cycle.
 *
 * @returns the branch's ticket reference, or undefined when the branch carries none
 */
export const readWorkOrderTicketRef = async ({ cwd }: Params): Promise<string | undefined> => {
	const branch = await readGitCurrentBranch({ cwd });

	if (branch === undefined) {
		return undefined;
	}

	return (await findWorkOrderForBranch({ cwd, branch }))?.record.ticketRef;
};
