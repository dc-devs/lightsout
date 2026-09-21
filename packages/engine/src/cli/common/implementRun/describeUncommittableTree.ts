import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';

interface Params {
	/** The workspace the run will build and commit in — never the checkout the command was launched from. */
	cwd: string;
	/** Whether that workspace is a tree lightsout cut or adopted for this run. An isolated tree is never judged. */
	isolated: boolean;
}

/**
 * Why the workspace cannot be committed in, or undefined when it can.
 *
 * Both implement commands ask this, because both now end in `git add -A`: in a
 * checkout a person chose to work in — the tree `--no-worktree` leaves a run
 * standing in — anything already there would ride into the ticket's branch.
 *
 * A tree lightsout cut or adopted for the run is never judged, and reads no git
 * state at all. A freshly cut worktree is born clean and has nothing to say,
 * while an adopted one is the planning session's tree for this very plan, or
 * the tree an earlier plan of the same ticket built in — whatever it holds is
 * the ticket's own work on the ticket's own branch.
 *
 * @returns the one sentence refusing the workspace, or undefined when the run may build in it
 */
export const describeUncommittableTree = async ({ cwd, isolated }: Params): Promise<string | undefined> => {
	if (isolated) {
		return undefined;
	}

	const dirty = await readGitChangedFiles({ cwd });
	let refusal: string | undefined;

	if (dirty === undefined) {
		refusal = `git could not read the tree at ${cwd} — the run commits what it builds, so it needs a readable git worktree`;
	} else if (dirty.length > 0) {
		refusal = `the run commits everything in the tree at ${cwd}; commit or stash your changes first`;
	}

	return refusal;
};
