import type { PullRequestState } from '#src/ship/forge/common/constants/PullRequestState.ts';
import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { toPullRequestSummary } from '#src/ship/forge/common/utils/toPullRequestSummary.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	branch: string;
	cwd: string;
	state: PullRequestState;
}

/**
 * The pull request on this branch in the state asked for, or undefined when
 * there is none.
 *
 * Anything unreadable — a non-zero exit, output that is not JSON, a row missing
 * a field — answers undefined, and both callers depend on that. Asked for
 * `Open`, undefined is ship's resume path deciding to open a new pull request.
 * Asked for `Merged`, undefined means the queue never confirmed a merge and
 * runs the worker, so absence of evidence never becomes evidence of a merge.
 */
export const findPullRequest = async ({ branch, cwd, state }: Params): Promise<PullRequestSummary | undefined> => {
	const listed = await runGh({
		args: ['pr', 'list', '--head', branch, '--state', state, '--json', 'number,url,title,headRefName', '--limit', '1'],
		cwd,
	});
	const rows = listed.exitCode === 0 ? parseForgeJson({ stdout: listed.stdout }) : undefined;

	return Array.isArray(rows) ? toPullRequestSummary({ row: rows[0] }) : undefined;
};
