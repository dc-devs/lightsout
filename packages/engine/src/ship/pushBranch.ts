import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	branch: string;
	cwd: string;
}

/**
 * Push the branch and set its upstream, answering whether git accepted it.
 *
 * A step of the sequence rather than a precondition: `implement --ship` chains
 * from a commit nobody has pushed, and `gh pr create` cannot open a pull
 * request for commits the remote has never seen. `--set-upstream` makes the
 * first push and every later one the same command, and a branch already pushed
 * and up to date exits 0 as a no-op — so re-running ship pushes again without
 * consequence.
 *
 * Its own deadline rather than `gitTimeoutMs`: that constant is sized for local
 * reads, and this one crosses the network.
 */
export const pushBranch = async ({ branch, cwd }: Params): Promise<boolean> => {
	const pushTimeoutMs = 60_000;
	const pushed = await runCommand({ command: `git push --set-upstream origin ${branch}`, cwd, timeoutMs: pushTimeoutMs }).catch(() => undefined);

	return pushed?.exitCode === 0;
};
