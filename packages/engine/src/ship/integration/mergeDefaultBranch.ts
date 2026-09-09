import { quoteGitArgument } from '#src/ship/common/utils/quoteGitArgument.ts';
import { runGit } from '#src/ship/common/utils/runGit.ts';
import type { MergeOutcome } from '#src/ship/integration/common/types/MergeOutcome.ts';
import { readUnmergedPaths } from '#src/ship/integration/readUnmergedPaths.ts';

interface Params {
	cwd: string;
	defaultBranch: string;
	onProgress?: (message: string) => void;
}

/** Nothing merged, and why — the shape every failure before the merge answers with. */
const noMerge = ({ failure, baseCommit }: { failure: string; baseCommit?: string }): MergeOutcome => ({
	baseCommit,
	conflictPaths: [],
	integrated: false,
	failure,
});

/** Whether the fetched base is already reachable from `HEAD`: exit 0 yes, exit 1 no, anything else an error rather than an answer. */
const isAlreadyIntegrated = async ({ cwd, baseCommit }: { cwd: string; baseCommit: string }): Promise<{ ancestor: boolean } | { error: string }> => {
	const checked = await runGit({ command: `git merge-base --is-ancestor ${quoteGitArgument({ argument: baseCommit })} HEAD`, cwd });

	if (checked?.exitCode === 0) {
		return { ancestor: true };
	}

	return checked?.exitCode === 1 ? { ancestor: false } : { error: `git could not say whether ${baseCommit} is already on the branch` };
};

/** The freshly fetched default commit, or the sentence saying why the fetch or the ref read did not produce one. */
const pinDefaultBranch = async ({ cwd, defaultBranch }: { cwd: string; defaultBranch: string }): Promise<{ baseCommit: string } | { error: string }> => {
	// The fetch crosses the network and takes a deadline of its own rather than
	// the git ceiling, which is sized for local reads.
	const fetchTimeoutMs = 60_000;
	const fetched = await runGit({ command: 'git fetch origin', cwd, timeoutMs: fetchTimeoutMs });

	if (fetched === undefined || fetched.exitCode !== 0) {
		return { error: `git could not fetch origin: ${(fetched?.stderr ?? 'git did not answer').trim()}` };
	}

	const resolved = await runGit({ command: `git rev-parse --verify ${quoteGitArgument({ argument: `origin/${defaultBranch}` })}`, cwd });

	if (resolved === undefined || resolved.exitCode !== 0) {
		return { error: `git could not resolve origin/${defaultBranch} after fetching` };
	}

	return { baseCommit: resolved.stdout.trim() };
};

/**
 * Fetch `origin` and merge the remote default branch into the checked-out
 * branch without committing it.
 *
 * The tracking ref is resolved to an immutable commit once, and only that
 * commit is used for the ancestor check and for the merge — so a default
 * branch that moves while the gates run cannot make the branch that was
 * verified and the branch that is pushed two different things. That commit
 * comes back as `baseCommit` even when nothing needed merging, because the
 * release hook versions against it.
 *
 * `--no-ff`, so a fast-forwardable branch still reaches the engine-owned commit
 * point; `--no-commit`, because committing is the caller's decision to make
 * once the gates have spoken. A conflicted merge is left open for the same
 * reason: this step names the conflict, and never resolves or aborts one.
 */
export const mergeDefaultBranch = async ({ cwd, defaultBranch, onProgress }: Params): Promise<MergeOutcome> => {
	onProgress?.(`integrate: fetching origin/${defaultBranch}`);

	const pinned = await pinDefaultBranch({ cwd, defaultBranch });

	if ('error' in pinned) {
		return noMerge({ failure: pinned.error });
	}

	const { baseCommit } = pinned;
	const ancestry = await isAlreadyIntegrated({ cwd, baseCommit });

	if ('error' in ancestry) {
		return noMerge({ failure: ancestry.error, baseCommit });
	}

	if (ancestry.ancestor) {
		onProgress?.(`integrate: origin/${defaultBranch} is already an ancestor — nothing to merge`);

		return { baseCommit, conflictPaths: [], integrated: false, failure: undefined };
	}

	const merged = await runGit({ command: `git merge --no-commit --no-ff ${quoteGitArgument({ argument: baseCommit })}`, cwd });

	if (merged?.exitCode === 0) {
		onProgress?.(`integrate: merged origin/${defaultBranch} cleanly`);

		return { baseCommit, conflictPaths: [], integrated: true, failure: undefined };
	}

	const conflictPaths = await readUnmergedPaths({ cwd });

	if (conflictPaths === undefined || conflictPaths.length === 0) {
		const said = (merged?.stderr ?? 'git did not answer').trim();

		return { baseCommit, conflictPaths: [], integrated: true, failure: `git could not merge origin/${defaultBranch}: ${said}` };
	}

	onProgress?.(`integrate: merging origin/${defaultBranch} left ${conflictPaths.length} path(s) unmerged`);

	return { baseCommit, conflictPaths, integrated: true, failure: undefined };
};
