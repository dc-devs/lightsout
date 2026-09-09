import { z } from 'zod';
import { maskSecrets } from '#src/ship/common/utils/maskSecrets.ts';
import type { CheckFailure } from '#src/ship/forge/common/types/CheckFailure.ts';
import { parseForgeJson } from '#src/ship/forge/common/utils/parseForgeJson.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	prNumber: number;
	/** The exact commit the caller pushed. Evidence that cannot be tied to it is no evidence. */
	commit: string;
	/** The names the check reader reported red, as the pull request spells them. */
	failingChecks: string[];
	cwd: string;
}

/** The pull request's head and its check rollup, read together so the rows and the commit come from one answer. */
const RollupView = z.object({
	headRefOid: z.string(),
	statusCheckRollup: z.array(z.object({ __typename: z.string() }).catchall(z.unknown())),
});

/** One Actions check on the rollup — the only kind of row a run can be read from. */
const ActionsCheck = z.object({ __typename: z.literal('CheckRun'), name: z.string(), conclusion: z.string(), detailsUrl: z.string() });

/** The runs the forge lists for one commit, used only when the check's own link did not name one. */
const RunRows = z.array(z.object({ databaseId: z.number(), headSha: z.string() }).catchall(z.unknown()));

/** One run's own account of what it was built from and which of its jobs failed. */
const RunDetail = z.object({
	headSha: z.string(),
	conclusion: z.string(),
	jobs: z.array(z.object({ databaseId: z.number(), name: z.string(), conclusion: z.string() }).catchall(z.unknown())),
});

/** How much of a failed job's output a repair attempt is handed. Past this a model is reading noise, not a cause. */
const maxEvidenceCharacters = 32_000;

/** The run a failing check points at: from its own job link when it has one, else from the commit's runs when exactly one is listed. */
const resolveRunId = async ({ check, commit, cwd }: { check: z.infer<typeof ActionsCheck>; commit: string; cwd: string }) => {
	const linked = /^https:\/\/[^/]+\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/job\/\d+/.exec(check.detailsUrl);
	const linkedRunId = linked === null ? undefined : linked[1];

	if (linkedRunId !== undefined) {
		return Number(linkedRunId);
	}

	const listed = await runGh({ args: ['run', 'list', '--commit', commit, '--json', 'databaseId,headSha,workflowName,status,conclusion'], cwd });
	const rows = RunRows.safeParse(parseForgeJson({ stdout: listed.stdout }));
	const matching = rows.success ? rows.data.filter((row) => row.headSha === commit) : [];

	// Two runs on the same commit and nothing saying which one the check came
	// from is ambiguity, and a repair built on the wrong run is worse than none.
	return matching.length === 1 ? matching[0]?.databaseId : undefined;
};

/** The failed job's own output, restricted to the job that failed and capped — or undefined when there is nothing attributable to read. */
const readFailedJobLog = async ({ runId, jobName, cwd }: { runId: number; jobName: string; cwd: string }) => {
	const logged = await runGh({ args: ['run', 'view', String(runId), '--log-failed'], cwd });

	if (logged.exitCode !== 0) {
		return undefined;
	}

	// `gh` prefixes every line with the job it came from, so one run's other
	// failures never reach a repair scoped to this check.
	const relevant = logged.stdout.split('\n').filter((line) => line.startsWith(`${jobName}\t`));

	if (relevant.length === 0) {
		return undefined;
	}

	const masked = maskSecrets({ text: relevant.join('\n') });

	return masked.length > maxEvidenceCharacters ? `${masked.slice(0, maxEvidenceCharacters)}\n… truncated: the failed job printed more than this` : masked;
};

/** One failing check's evidence, or undefined when any reading could not tie it to the commit asked about. */
const readOneFailure = async ({ rollup, name, commit, cwd }: { rollup: z.infer<typeof RollupView>; name: string; commit: string; cwd: string }) => {
	const parsed = rollup.statusCheckRollup.map((entry) => ActionsCheck.safeParse(entry));
	const row = parsed.find((candidate) => candidate.success && candidate.data.name === name);

	if (row === undefined || !row.success) {
		return undefined;
	}

	const runId = await resolveRunId({ check: row.data, commit, cwd });

	if (runId === undefined) {
		return undefined;
	}

	const viewed = await runGh({ args: ['run', 'view', String(runId), '--json', 'headSha,jobs,attempt,conclusion'], cwd });
	const detail = RunDetail.safeParse(parseForgeJson({ stdout: viewed.stdout }));

	if (!detail.success || detail.data.headSha !== commit || detail.data.conclusion !== 'failure') {
		return undefined;
	}

	const job = detail.data.jobs.find((entry) => entry.name === name && entry.conclusion === 'failure');
	const output = job === undefined ? undefined : await readFailedJobLog({ runId, jobName: job.name, cwd });

	return output === undefined ? undefined : { name, runId, commit, output };
};

/**
 * The failing checks' own output for one exact commit, or `undefined` when it
 * cannot be attributed to that commit.
 *
 * A repair agent may only be handed evidence that demonstrably belongs to the
 * candidate it is repairing, so every reading has to agree: the pull request
 * stands on the commit, the run was built from it, the job that failed is the
 * check that was reported red, and the head has not moved by the time the logs
 * are in hand. Anything unreadable, ambiguous, from another provider or from
 * another commit answers `undefined`, and the caller blocks rather than
 * guessing.
 *
 * Only repository-owned Actions URLs are parsed; nothing here fetches an
 * arbitrary link a check happened to carry.
 */
export const readCheckFailureLogs = async ({ prNumber, commit, failingChecks, cwd }: Params): Promise<CheckFailure[] | undefined> => {
	const viewed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'headRefOid,statusCheckRollup'], cwd });
	const rollup = RollupView.safeParse(parseForgeJson({ stdout: viewed.stdout }));

	if (!rollup.success || rollup.data.headRefOid !== commit) {
		return undefined;
	}

	const failures: CheckFailure[] = [];

	for (const name of failingChecks) {
		const failure = await readOneFailure({ rollup: rollup.data, name, commit, cwd });

		if (failure === undefined) {
			return undefined;
		}

		failures.push(failure);
	}

	const confirmed = await runGh({ args: ['pr', 'view', String(prNumber), '--json', 'headRefOid'], cwd });
	const stillOn = RollupView.pick({ headRefOid: true }).safeParse(parseForgeJson({ stdout: confirmed.stdout }));

	return stillOn.success && stillOn.data.headRefOid === commit && failures.length > 0 ? failures : undefined;
};
