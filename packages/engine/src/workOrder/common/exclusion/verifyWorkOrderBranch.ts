import { readConfig } from '#src/common/config/readConfig.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { runGates } from '#src/gates/runGates.ts';
import { readLiveRunLock } from '#src/runState/lock/readLiveRunLock.ts';
import { readBranchWorktree } from '#src/worktree/readBranchWorktree.ts';

interface Params {
	/** Any checkout of the repository: the checkout that holds the branch is found from it. */
	cwd: string;
	/** The ticket's branch, which every plan of it implements on. */
	branch: string;
	onProgress?: (message: string) => void;
}

/**
 * The ticket branch, checked the way shipping checks it: nothing else editing
 * the tree, nothing uncommitted in it, and the repository's own full gates
 * green on the commit it stands on. The engine cannot prove a plan's code was
 * removed, so the human's declaration is what says it was and a passed commit
 * is what backs it. Gates beside a live run would verify a tree that is still
 * changing, so a holder is refused before the clean check and before any gate.
 */
export const verifyWorkOrderBranch = async ({ cwd, branch, onProgress }: Params): Promise<{ commit: string } | { error: string }> => {
	const checkout = await readBranchWorktree({ cwd, branch });

	if (checkout === undefined) {
		return {
			error: `no checkout of this repository holds ${branch}, and excluding a plan whose implementation started means verifying that branch first — check it out, or cut its worktree, and run this again`,
		};
	}

	const holder = await readLiveRunLock({ cwd: checkout });

	if (holder !== undefined) {
		return {
			error: `run ${holder.runId} is still working in ${checkout}, so the gates there would verify a tree that is still changing — wait for that run to finish, or stop it`,
		};
	}

	const changed = await readGitChangedFiles({ cwd: checkout });

	if (changed === undefined || changed.length > 0) {
		return {
			error: `${checkout} has ${changed === undefined ? 'no readable git status' : `${changed.length} uncommitted change(s)`}, so nothing there can be verified — commit or discard them and run this again`,
		};
	}

	const commit = await readGitHeadCommit({ cwd: checkout });

	if (commit === undefined) {
		return { error: `the commit ${checkout} stands on could not be read, so no verified commit could be recorded against the exclusion` };
	}

	const gates = await runGates({ cwd: checkout, config: await readConfig({ cwd: checkout }), coverage: true, includeRoot: true, onProgress });

	return gates.error === undefined
		? { commit }
		: { error: `this repository's own gates are red on ${branch} at ${commit}, so it cannot be verified:\n${gates.error}` };
};
