import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	cwd: string;
	/** A full ref name, such as `refs/heads/<branch>` or `refs/remotes/origin/<branch>`. */
	ref: string;
}

/**
 * The commit a ref names, or undefined when the ref does not exist.
 *
 * `readGitHeadCommit` answers for the checkout a command is standing in; this
 * answers for a ref it is not standing on, which is what lets a later plan's
 * tree be cut at the ticket branch's pushed tip. The ref is peeled to a commit,
 * so an annotated tag answers the commit rather than the tag object, and the
 * argument is quoted because that peel suffix carries shell metacharacters.
 *
 * Nothing is fetched: a remote-tracking ref answers what the last fetch left
 * behind, and reaching the network here would make every tree resolution wait
 * on it. Same never-throw contract as its neighbours — absence is a value.
 */
export const readGitRefCommit = async ({ cwd, ref }: Params): Promise<string | undefined> => {
	const named = await runCommand({ command: `git rev-parse --verify --quiet '${ref}^{commit}'`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	return named?.exitCode === 0 ? named.stdout.trim() : undefined;
};
