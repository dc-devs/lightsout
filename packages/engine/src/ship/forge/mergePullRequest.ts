import { z } from 'zod';
import type { ShipMergeMethod } from '#src/contracts/index.ts';
import { remoteWaitTimings } from '#src/ship/common/constants/remoteWaitTimings.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import { sleep } from '#src/ship/common/utils/sleep.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	prNumber: number;
	mergeMethod: ShipMergeMethod;
	cwd: string;
	/** The exact commit this invocation pushed and verified — the only head it may ever merge. */
	expectedHead: string;
}

/**
 * The pull request's own state, which is the only thing that can say whether a
 * merge happened and whether another attempt could change the answer.
 *
 * Everything past `state` and `mergeCommit` is optional: a forge that answers
 * an older field set still lets a confirmed merge be recognised, and a missing
 * field simply fails the narrow test a recoverable refusal has to pass.
 */
const StateView = z.object({
	state: z.string(),
	mergeCommit: z.object({ oid: z.string() }).nullable(),
	headRefOid: z.string().optional(),
	mergeStateStatus: z.string().optional(),
	reviewDecision: z.string().nullable().optional(),
});

type StateView = z.infer<typeof StateView>;

/** Review decisions that mean a human has to act, whatever else the pull request says about itself. */
const humanReviewDecisions = new Set(['REVIEW_REQUIRED', 'CHANGES_REQUESTED']);

/** The pull request as the forge holds it now, or undefined when the answer could not be read at all. */
const readState = async ({ prNumber, cwd }: { prNumber: number; cwd: string }) => {
	const viewed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'state,mergeCommit,headRefOid,mergeStateStatus,reviewDecision'], cwd });
	const view = StateView.safeParse(parseForgeJson({ stdout: viewed.stdout }));

	return { view: view.success ? view.data : undefined, stderr: viewed.stderr };
};

/**
 * Whether a refusal was only a base that had moved on.
 *
 * Read from the pull request's structured state and never from the message:
 * GitHub prints the same "Base branch was modified" sentence for refusals a
 * retry cannot fix, so a classifier that read the words would spend whole
 * attempts on a protected branch or a missing review. Everything else —
 * `BLOCKED`, `UNKNOWN`, a head someone else moved, an unreadable answer — is
 * final.
 */
const isStaleBase = ({ view, expectedHead }: { view: StateView | undefined; expectedHead: string }) =>
	view !== undefined &&
	view.headRefOid === expectedHead &&
	view.state === 'OPEN' &&
	view.mergeStateStatus === 'BEHIND' &&
	!humanReviewDecisions.has(view.reviewDecision ?? '');

/**
 * Wait for a merge the forge accepted to actually land.
 *
 * A merge queue answers the command with a zero exit and merges minutes later,
 * so a caller that read the exit code as the answer would report a shipped
 * result for a pull request still sitting in a queue. The command is never
 * re-sent: only the read-back is repeated, under the same ceiling the check
 * wait uses.
 */
const confirmMerge = async ({ prNumber, cwd, mergeStderr }: { prNumber: number; cwd: string; mergeStderr: string }): Promise<string | ShipStepFailure> => {
	const { pollIntervalMs, ceilingMs } = remoteWaitTimings;
	const startedAt = Date.now();
	let last: StateView | undefined;
	let lastStderr = mergeStderr;

	for (;;) {
		const { view, stderr } = await readState({ prNumber, cwd });

		last = view;
		lastStderr = stderr.trim() === '' ? lastStderr : stderr;

		if (view?.state === 'MERGED') {
			return view.mergeCommit === null ? { stderr: lastStderr } : view.mergeCommit.oid;
		}

		if (Date.now() - startedAt >= ceilingMs) {
			return { stderr: `the forge accepted the merge but #${prNumber} is still ${last?.state ?? 'unreadable'} at the wait ceiling` };
		}

		await sleep({ ms: pollIntervalMs });
	}
};

/**
 * Merge the pull request, delete its branch on the forge, and answer with the
 * commit the merge produced.
 *
 * `--match-head-commit` is what makes the merge conditional: the commit this
 * invocation pushed and verified is the only one it may land, so a commit
 * somebody else pushed while the checks ran cannot be merged under this
 * invocation's evidence. `--delete-branch` is the "branch deleted" step of the
 * ship sequence, done by the forge so the remote branch goes with the merge.
 * Nothing here admin-bypasses, and nothing here picks a method other than the
 * configured one.
 *
 * A merged pull request is only ever reported from the forge's own state, in
 * both directions: a non-zero exit whose read-back says MERGED is a merge,
 * because `gh pr merge` also does local cleanup that always fails inside a
 * linked worktree, and a zero exit whose read-back says OPEN is not one, because
 * a merge queue accepts before it lands.
 *
 * @returns the merge commit, or the refusal — carrying `staleBase` only when the forge's own state proved a newer base is the whole problem
 */
export const mergePullRequest = async ({ prNumber, mergeMethod, cwd, expectedHead }: Params): Promise<string | ShipStepFailure> => {
	const merged = await runGh({
		args: ['pr', 'merge', String(prNumber), `--${mergeMethod}`, '--delete-branch', '--match-head-commit', expectedHead],
		cwd,
	});

	if (merged.exitCode === 0) {
		return confirmMerge({ prNumber, cwd, mergeStderr: merged.stderr });
	}

	const { view } = await readState({ prNumber, cwd });

	if (view?.state === 'MERGED' && view.mergeCommit !== null) {
		return view.mergeCommit.oid;
	}

	return isStaleBase({ view, expectedHead }) ? { stderr: merged.stderr, staleBase: true } : { stderr: merged.stderr };
};
