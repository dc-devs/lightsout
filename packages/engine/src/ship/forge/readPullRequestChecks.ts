import { z } from 'zod';
import type { ChecksSummary } from '#src/ship/forge/common/types/ChecksSummary.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	prNumber: number;
	cwd: string;
}

/** The rows `gh pr checks --json name,state,bucket` prints; anything unrecognisable is dropped rather than guessed at. */
const CheckRows = z.array(z.object({ name: z.string(), bucket: z.string() }).catchall(z.unknown()));

/** The buckets `gh` sorts a check into that mean "it finished and it did not pass". */
const redBuckets = new Set(['fail', 'cancel']);

/** The buckets that mean "nothing is left to wait for here": a pass, and a check the forge chose not to run. */
const greenBuckets = new Set(['pass', 'skipping']);

/**
 * Where a pull request's checks stand right now.
 *
 * `gh pr checks` exits 8 while checks are pending and 1 when some failed, so
 * the exit code is deliberately ignored and only the JSON is read — the rows
 * are the answer, and both of those exits carry rows. `skipping` counts as
 * done and green: a check the forge chose not to run cannot be waited on.
 *
 * A pull request with no checks configured yields an empty array, which folds
 * to finished and green. This reader reports what the forge says now; whether
 * "no checks yet" means "no CI" is `waitForChecks`'s call, via its grace
 * window.
 */
export const readPullRequestChecks = async ({ prNumber, cwd }: Params): Promise<ChecksSummary | undefined> => {
	const checked = await runGh({ args: ['pr', 'checks', String(prNumber), '--json', 'name,state,bucket'], cwd });
	const rows = CheckRows.safeParse(parseForgeJson({ stdout: checked.stdout }));

	if (!rows.success) {
		return undefined;
	}

	const failing = rows.data.filter((row) => redBuckets.has(row.bucket)).map((row) => row.name);
	const pending = rows.data.filter((row) => row.bucket === 'pending').map((row) => row.name);
	const passing = rows.data.filter((row) => greenBuckets.has(row.bucket)).map((row) => row.name);

	return { finished: pending.length === 0, green: failing.length === 0, failing, pending, passing };
};
