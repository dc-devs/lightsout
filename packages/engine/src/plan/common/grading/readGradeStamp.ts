import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';

interface Params {
	cwd: string;
}

/**
 * Which code a grade was measured against: the commit `HEAD` was at, and
 * whether uncommitted work sat beside it. `gradedAt` says when a verdict was
 * taken; this says against what.
 *
 * The two probes are separate statements rather than one optional-chained
 * expression because `readGitChangedFiles` fails independently of the commit
 * read: an undefined flag means the tree state was NOT READ, never that it was
 * read and found clean. Grading almost always happens with uncommitted work in
 * the tree, which is why the commit is recorded rather than withheld when the
 * flag is true.
 */
export const readGradeStamp = async ({ cwd }: Params): Promise<{ commit: string | undefined; treeDirty: boolean | undefined }> => {
	const commit = await readGitHeadCommit({ cwd });
	const changed = commit === undefined ? undefined : await readGitChangedFiles({ cwd });

	return { commit, treeDirty: changed === undefined ? undefined : changed.length > 0 };
};
