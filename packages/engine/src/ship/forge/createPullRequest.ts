import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { toPullRequestSummary } from '#src/ship/forge/common/utils/toPullRequestSummary.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	branch: string;
	/** The rendered pull request body — what replaces the commit-derived one. */
	body: string;
	cwd: string;
}

/** The pull request number out of the URL `gh pr create` prints, or undefined when that line is not a URL ending in one. */
const readCreatedNumber = ({ stdout }: { stdout: string }) => {
	const segment = stdout.trim().split('\n').at(-1)?.split('/').at(-1) ?? '';
	const parsed = Number.parseInt(segment, 10);

	return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Open a pull request for this branch and return it.
 *
 * Three `gh` calls, because one cannot do it. `--fill-first` takes the title
 * and body from the branch's FIRST commit, which is the deterministic "what
 * shipped" line the ship result carries — plain `--fill` would use the branch
 * name as the title on a multi-commit branch, turning it into a slug. `gh pr
 * create` refuses `--body` alongside `--fill-first`, so the rendered body is
 * written by a second call, and the third reads back what the forge actually
 * recorded rather than trusting what was asked for.
 *
 * Any of the three exiting non-zero answers that call's own stderr, so the
 * caller can tell a refused create from a refused edit without another round
 * trip; it turns that into a blocked result.
 */
export const createPullRequest = async ({ branch, body, cwd }: Params): Promise<PullRequestSummary | ShipStepFailure> => {
	const created = await runGh({ args: ['pr', 'create', '--fill-first', '--head', branch], cwd });
	const prNumber = created.exitCode === 0 ? readCreatedNumber({ stdout: created.stdout }) : undefined;

	if (prNumber === undefined) {
		return { stderr: created.stderr };
	}

	const edited = await runGh({ args: ['pr', 'edit', String(prNumber), '--body', body], cwd });

	if (edited.exitCode !== 0) {
		return { stderr: edited.stderr };
	}

	const viewed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'number,url,title,headRefName'], cwd });
	const summary = viewed.exitCode === 0 ? toPullRequestSummary({ row: parseForgeJson({ stdout: viewed.stdout }) }) : undefined;

	return summary ?? { stderr: viewed.stderr };
};
