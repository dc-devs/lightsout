import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import { quoteGitArgument } from '#src/ship/common/utils/quoteGitArgument.ts';
import { runGit } from '#src/ship/common/utils/runGit.ts';
import { pushBranch } from '#src/ship/pushBranch.ts';

interface Params {
	branch: string;
	cwd: string;
	/** The exact commit this attempt verified — the only thing that counts as published. */
	candidate: string;
}

/** What the remote holds for the branch right now, or undefined when it could not be read at all. */
const readRemoteTip = async ({ branch, cwd }: { branch: string; cwd: string }) => {
	const remoteReadTimeoutMs = 60_000;
	const listed = await runGit({ command: `git ls-remote --heads origin ${quoteGitArgument({ argument: branch })}`, cwd, timeoutMs: remoteReadTimeoutMs });

	return listed?.exitCode === 0 ? listed.stdout.trim().split('\t')[0] : undefined;
};

/**
 * Push the verified candidate, and read the remote back when git said no.
 *
 * A push whose command failed may still have published — a connection dropped
 * after the pack was accepted looks exactly like one that was not — so the
 * remote's own ref is what answers. Nothing here force-pushes, and nothing here
 * retries an ambiguous outcome: an exact match with the candidate is the only
 * reading that counts as published.
 *
 * @returns undefined once the candidate is on the remote, else the push's own failure
 */
export const publishCandidate = async ({ branch, cwd, candidate }: Params): Promise<ShipStepFailure | undefined> => {
	const failure = await pushBranch({ branch, cwd });

	if (failure === undefined) {
		return undefined;
	}

	return (await readRemoteTip({ branch, cwd })) === candidate ? undefined : failure;
};
