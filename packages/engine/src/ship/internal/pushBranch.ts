import { runCommand } from '#src/common/processes/runCommand.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';

interface Params {
	branch: string;
	cwd: string;
}

/**
 * Push the branch and set its upstream, answering undefined when git accepted
 * the push and the push's own stderr when it did not.
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
export const pushBranch = async ({ branch, cwd }: Params): Promise<ShipStepFailure | undefined> => {
	const pushTimeoutMs = 60_000;
	const pushed = await runCommand({ command: `git push --set-upstream origin ${branch}`, cwd, timeoutMs: pushTimeoutMs }).catch((error) => ({
		exitCode: -1,
		stdout: '',
		stderr: messageOf({ error }),
	}));

	return pushed.exitCode === 0 ? undefined : { stderr: pushed.stderr };
};
