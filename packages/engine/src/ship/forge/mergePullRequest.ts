import { z } from 'zod';
import type { ShipMergeMethod } from '#src/contracts/index.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	prNumber: number;
	mergeMethod: ShipMergeMethod;
	cwd: string;
}

/** What `gh pr view --json mergeCommit` prints once the merge has landed. */
const MergedView = z.object({ mergeCommit: z.object({ oid: z.string() }) });

/**
 * Merge the pull request, delete its branch on the forge, and answer with the
 * commit the merge produced.
 *
 * `--delete-branch` is the "branch deleted" step of the ship sequence, done by
 * the forge so the remote branch goes with the merge rather than lingering
 * until someone remembers it. A non-zero exit — a conflict, a protected
 * branch, a missing review — answers undefined, and so does a merge that
 * landed but whose commit the forge would not name, because a shipped result
 * with no merge commit in it is not one a tracker skill can use.
 */
export const mergePullRequest = async ({ prNumber, mergeMethod, cwd }: Params): Promise<string | undefined> => {
	const merged = await runGh({ args: ['pr', 'merge', String(prNumber), `--${mergeMethod}`, '--delete-branch'], cwd });

	if (merged.exitCode !== 0) {
		return undefined;
	}

	const viewed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'mergeCommit'], cwd });
	const view = MergedView.safeParse(parseForgeJson({ stdout: viewed.stdout }));

	return view.success ? view.data.mergeCommit.oid : undefined;
};
