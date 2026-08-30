import { z } from 'zod';
import type { ShipMergeMethod } from '#src/contracts/index.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	prNumber: number;
	mergeMethod: ShipMergeMethod;
	cwd: string;
}

/** What `gh pr view --json mergeCommit` prints once the merge has landed. */
const MergedView = z.object({ mergeCommit: z.object({ oid: z.string() }) });

/** The read-back a failed merge command gets: the pull request's real state, because the exit code alone cannot be trusted to mean "not merged". */
const StateView = z.object({ state: z.string(), mergeCommit: z.object({ oid: z.string() }).nullable() });

/**
 * Whether the pull request in fact merged despite the merge command's non-zero
 * exit — `gh pr merge` also does local cleanup (a checkout of the default
 * branch to delete the merged branch), and inside a linked worktree that
 * cleanup always fails *after* the forge has already merged. Only the forge's
 * own state answers the question; an unreadable state stays a failure.
 */
const readMergedAnyway = async ({ prNumber, cwd }: { prNumber: number; cwd: string }) => {
	const viewed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'state,mergeCommit'], cwd });
	const view = StateView.safeParse(parseForgeJson({ stdout: viewed.stdout }));

	return view.success && view.data.state === 'MERGED' && view.data.mergeCommit !== null ? view.data.mergeCommit.oid : undefined;
};

/**
 * Merge the pull request, delete its branch on the forge, and answer with the
 * commit the merge produced.
 *
 * `--delete-branch` is the "branch deleted" step of the ship sequence, done by
 * the forge so the remote branch goes with the merge rather than lingering
 * until someone remembers it. A non-zero exit — a conflict, a protected
 * branch, a missing review — answers the merge's own stderr, unless the forge
 * says the merge in fact landed, because a merged pull request reported as a
 * refusal parks a ticket whose work is already on the default branch. A merge
 * that landed but whose commit the forge would not name answers the
 * read-back's stderr, which is usually empty, because a shipped result with no
 * merge commit in it is not one a tracker skill can use.
 */
export const mergePullRequest = async ({ prNumber, mergeMethod, cwd }: Params): Promise<string | ShipStepFailure> => {
	const merged = await runGh({ args: ['pr', 'merge', String(prNumber), `--${mergeMethod}`, '--delete-branch'], cwd });

	if (merged.exitCode !== 0) {
		return (await readMergedAnyway({ prNumber, cwd })) ?? { stderr: merged.stderr };
	}

	const viewed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'mergeCommit'], cwd });
	const view = MergedView.safeParse(parseForgeJson({ stdout: viewed.stdout }));

	return view.success ? view.data.mergeCommit.oid : { stderr: viewed.stderr };
};
