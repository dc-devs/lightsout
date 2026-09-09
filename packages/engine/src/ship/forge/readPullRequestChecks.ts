import { z } from 'zod';
import type { ChecksSummary } from '#src/ship/forge/common/types/ChecksSummary.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	prNumber: number;
	cwd: string;
	/** The exact candidate commit the caller pushed — the only commit whose rows may count. */
	expectedHead: string;
}

/** The rows `gh pr checks --json name,state,bucket` prints; anything unrecognisable is dropped rather than guessed at. */
const CheckRows = z.array(z.object({ name: z.string(), bucket: z.string() }).catchall(z.unknown()));

/** What the pull request's head is right now — the only thing that can tie a set of rows to a commit. */
const HeadView = z.object({ headRefOid: z.string() });

/** The buckets `gh` sorts a check into that mean "it finished and it did not pass". */
const redBuckets = new Set(['fail', 'cancel']);

/** The buckets that mean "nothing is left to wait for here": a pass, and a check the forge chose not to run. */
const greenBuckets = new Set(['pass', 'skipping']);

/** Every bucket this reader knows how to fold. One it does not is missing evidence, never a green. */
const knownBuckets = new Set([...redBuckets, ...greenBuckets, 'pending']);

/** Whether the pull request stands on the exact commit the caller asked about. */
const standsOnExpectedHead = async ({ prNumber, cwd, expectedHead }: Params) => {
	const viewed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'headRefOid'], cwd });
	const head = HeadView.safeParse(parseForgeJson({ stdout: viewed.stdout }));

	return head.success && head.data.headRefOid === expectedHead;
};

/**
 * Where a pull request's checks stand right now, for the commit the caller
 * pushed.
 *
 * `gh pr checks` exits 8 while checks are pending and 1 when some failed, so
 * the exit code is deliberately ignored and only the JSON is read — the rows
 * are the answer, and both of those exits carry rows. `skipping` counts as
 * done and green: a check the forge chose not to run cannot be waited on. A
 * bucket outside the supported set answers `undefined` rather than folding to
 * green, because a verdict this reader cannot name is not one it may pass on.
 *
 * The head is read immediately before and after the rows, so a commit someone
 * else pushed while they were being read can never be merged under this
 * invocation's evidence. Either read disagreeing is missing evidence, not a
 * failure — the caller polls again.
 *
 * A pull request with no checks configured yields an empty array, which folds
 * to finished and green. This reader reports what the forge says now; whether
 * "no checks yet" means "no CI" is `waitForChecks`'s call.
 */
export const readPullRequestChecks = async ({ prNumber, cwd, expectedHead }: Params): Promise<ChecksSummary | undefined> => {
	if (!(await standsOnExpectedHead({ prNumber, cwd, expectedHead }))) {
		return undefined;
	}

	const checked = await runGh({ args: ['pr', 'checks', String(prNumber), '--json', 'name,state,bucket'], cwd });
	const rows = CheckRows.safeParse(parseForgeJson({ stdout: checked.stdout }));

	if (!rows.success || rows.data.some((row) => !knownBuckets.has(row.bucket))) {
		return undefined;
	}

	if (!(await standsOnExpectedHead({ prNumber, cwd, expectedHead }))) {
		return undefined;
	}

	const failing = rows.data.filter((row) => redBuckets.has(row.bucket)).map((row) => row.name);
	const pending = rows.data.filter((row) => row.bucket === 'pending').map((row) => row.name);
	const passing = rows.data.filter((row) => greenBuckets.has(row.bucket)).map((row) => row.name);

	return { finished: pending.length === 0, green: failing.length === 0, failing, pending, passing, readable: true };
};
