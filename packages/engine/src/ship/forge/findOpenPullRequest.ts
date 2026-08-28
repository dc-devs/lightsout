import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { toPullRequestSummary } from '#src/ship/forge/common/utils/toPullRequestSummary.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	branch: string;
	cwd: string;
}

/**
 * The open pull request already on this branch, or undefined when there is
 * none.
 *
 * This is ship's resume path: a re-run after a red check finds the pull request
 * the previous run opened and continues from it rather than failing on a branch
 * that already has one. Anything unreadable — a non-zero exit, output that is
 * not JSON, a row missing a field — answers undefined, and the caller opens a
 * new one.
 */
export const findOpenPullRequest = async ({ branch, cwd }: Params): Promise<PullRequestSummary | undefined> => {
	const listed = await runGh({
		args: ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,title,headRefName', '--limit', '1'],
		cwd,
	});
	const rows = listed.exitCode === 0 ? parseForgeJson({ stdout: listed.stdout }) : undefined;

	return Array.isArray(rows) ? toPullRequestSummary({ row: rows[0] }) : undefined;
};
