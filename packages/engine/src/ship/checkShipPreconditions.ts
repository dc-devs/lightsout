import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import { readGitDefaultBranch } from '#src/common/git/readGitDefaultBranch.ts';
import { ShipBlockReason } from '#src/contracts/index.ts';
import { readForgeAuth } from '#src/ship/forge/index.ts';
import { readTicketMatch } from '#src/ship/readTicketMatch.ts';

interface Params {
	cwd: string;
	ticketPattern: RegExp;
}

/** Everything the sequence needs before it may touch the forge, once every precondition has held. */
interface ShipPreconditionsMet {
	branch: string;
	/** Read here rather than again later, so the sync step and the "not on it" check cannot disagree. */
	defaultBranch: string;
	/** The branch's ticket capture groups — `ticket` plus whatever else the pattern names. */
	ticket: Record<string, string>;
}

/** The first precondition that did not hold, and whatever was known by then. */
interface ShipPreconditionsBlocked {
	reason: ShipBlockReason;
	detail: string;
	branch?: string;
}

type ShipPreconditions = ShipPreconditionsMet | ShipPreconditionsBlocked;

/** The dirty-tree detail: enough paths to recognise the problem, not the whole `git status`. */
const describeDirtyTree = ({ changed }: { changed: string[] | undefined }) => {
	const shownPaths = 5;

	if (changed === undefined) {
		return 'git could not list the working tree, so ship cannot tell whether it is clean';
	}

	const shown = changed.slice(0, shownPaths).join(', ');
	const rest = changed.length > shownPaths ? `, and ${changed.length - shownPaths} more` : '';

	return `working tree is not clean: ${shown}${rest}`;
};

/**
 * Everything that must be true before ship may push anything, checked in the
 * order that names the first real problem rather than a cascade.
 *
 * Pushing is not among them: it is a step of the sequence, so a branch nobody
 * has pushed is shippable and `implement --ship` can chain straight off its own
 * commit. What is checked here is what no later step could recover from — a
 * detached HEAD, the default branch itself, uncommitted work, a branch name
 * carrying no ticket, and a `gh` that cannot speak for this repository.
 */
export const checkShipPreconditions = async ({ cwd, ticketPattern }: Params): Promise<ShipPreconditions> => {
	const branch = await readGitCurrentBranch({ cwd });

	if (branch === undefined) {
		return { reason: ShipBlockReason.GitUnreadable, detail: `not on a branch in a git worktree at ${cwd}` };
	}

	const defaultBranch = await readGitDefaultBranch({ cwd });

	if (defaultBranch === undefined) {
		return { reason: ShipBlockReason.DefaultBranch, detail: 'origin/HEAD is unset, so ship cannot tell what it would merge into', branch };
	}

	if (defaultBranch === branch) {
		return { reason: ShipBlockReason.DefaultBranch, detail: `already on the default branch '${branch}'`, branch };
	}

	const changed = await readGitChangedFiles({ cwd });

	if (changed === undefined || changed.length > 0) {
		return { reason: ShipBlockReason.DirtyTree, detail: describeDirtyTree({ changed }), branch };
	}

	const ticket = readTicketMatch({ branch, ticketPattern });

	if (ticket === undefined) {
		return { reason: ShipBlockReason.TicketPatternMismatch, detail: `branch '${branch}' does not match ${ticketPattern.source}`, branch };
	}

	if (!(await readForgeAuth({ cwd }))) {
		return { reason: ShipBlockReason.ForgeNotAuthenticated, detail: 'gh is not installed, or is not logged in for this repository’s host', branch };
	}

	return { branch, defaultBranch, ticket };
};
