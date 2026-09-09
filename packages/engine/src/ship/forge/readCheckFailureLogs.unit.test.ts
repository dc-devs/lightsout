import { describe, expect, test } from '@jest/globals';
import { type CheckFailure, readCheckFailureLogs } from '#src/ship/forge/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** What one stubbed `gh` invocation answers with, mirroring the shared forge stub's own shape. */
interface ForgeAnswer {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

/** One whole forge for one scenario: an answer per command prefix, or a sequence of answers for repeated identical reads. */
type ForgeTable = Record<string, ForgeAnswer | ForgeAnswer[]>;

/** The commit the caller pushed and is asking about. Only evidence naming this one is attributable. */
const candidateCommit = '7f3c1ab29d4e5061728394a5b6c7d8e9f0a1b2c3';

/** A later commit pushed to the same branch, which no evidence for the candidate may come from. */
const supersedingCommit = '0e1d2c3b4a5968778695a4b3c2d1e0f918273645';

/** The Actions job the failing check links to on the attributable readings. */
const jobUrl = 'https://github.com/dc-devs/lightsout/actions/runs/77/job/912';

/** The failed job's own output — the only thing a repair attempt is allowed to read. */
const failedJobLog = ['unit\tRun pnpm test:unit', 'unit\t  AssertionError: expected 3 to be 4', ''].join('\n');

/** What a capped log ends with, so a cut is legible as a cut rather than as a run that stopped there. */
const truncationMarker = '\n… truncated: the failed job printed more than this';

const actionsCheck = ({ detailsUrl }: { detailsUrl: string }) => ({
	__typename: 'CheckRun',
	name: 'unit',
	status: 'COMPLETED',
	conclusion: 'FAILURE',
	detailsUrl,
});

const foreignCheck = () => ({
	__typename: 'StatusContext',
	context: 'unit',
	state: 'FAILURE',
	targetUrl: 'https://buildkite.example.com/dc-devs/lightsout/builds/77',
});

const pullRequestView = ({ head, checks }: { head: string; checks: unknown[] }): ForgeAnswer => ({
	stdout: JSON.stringify({ headRefOid: head, statusCheckRollup: checks }),
});

const runList = ({ rows }: { rows: { id: number; head: string }[] }): ForgeAnswer => ({
	stdout: JSON.stringify(rows.map(({ id, head }) => ({ databaseId: id, headSha: head, workflowName: 'CI', status: 'completed', conclusion: 'failure' }))),
});

const runDetail = ({ head }: { head: string }): ForgeAnswer => ({
	stdout: JSON.stringify({ headSha: head, attempt: 1, conclusion: 'failure', jobs: [{ databaseId: 912, name: 'unit', conclusion: 'failure' }] }),
});

/** The forge as it stands when every reading points at the candidate commit's own failed job. */
const attributableForge = (): ForgeTable => ({
	'pr view': pullRequestView({ head: candidateCommit, checks: [actionsCheck({ detailsUrl: jobUrl })] }),
	'run list': runList({ rows: [{ id: 77, head: candidateCommit }] }),
	'run view 77 --json': runDetail({ head: candidateCommit }),
	'run view 77 --log-failed': { stdout: failedJobLog },
});

const setupForgeScenarios = async () => {
	const cwd = await freshCwd();

	const scenarios: Record<string, ForgeTable> = {
		attributable: attributableForge(),
		pullRequestHeadMoved: {
			...attributableForge(),
			// The head is replaced between the first reading and the confirming one.
			'pr view': [
				pullRequestView({ head: candidateCommit, checks: [actionsCheck({ detailsUrl: jobUrl })] }),
				pullRequestView({ head: supersedingCommit, checks: [actionsCheck({ detailsUrl: jobUrl })] }),
			],
		},
		wrongPullRequestHead: {
			...attributableForge(),
			// The pull request never stood on the commit the caller is asking about.
			'pr view': pullRequestView({ head: supersedingCommit, checks: [actionsCheck({ detailsUrl: jobUrl })] }),
		},
		// The failing check is another provider's CI, so there is no Actions run to read logs from.
		foreignProviderCheck: {
			'pr view': pullRequestView({ head: candidateCommit, checks: [foreignCheck()] }),
			'run list': runList({ rows: [] }),
		},
		// Two runs of the same workflow sit on the commit and nothing says which one the check came from.
		ambiguousRuns: {
			'pr view': pullRequestView({ head: candidateCommit, checks: [actionsCheck({ detailsUrl: 'https://github.com/dc-devs/lightsout/actions' })] }),
			'run list': runList({
				rows: [
					{ id: 77, head: candidateCommit },
					{ id: 78, head: candidateCommit },
				],
			}),
		},
		runOnAnotherCommit: {
			...attributableForge(),
			// The run the check points at was built from a different commit.
			'run view 77 --json': runDetail({ head: supersedingCommit }),
		},
		malformedRunMetadata: {
			...attributableForge(),
			// The forge answered the run query with a login prompt rather than the run.
			'run view 77 --json': { stdout: 'gh: not logged in to github.com', exitCode: 1 },
		},
		unreadableLogs: {
			...attributableForge(),
			// The right run, whose logs have expired and cannot be downloaded.
			'run view 77 --log-failed': { stdout: '', stderr: 'failed to download logs: HTTP 410', exitCode: 1 },
		},
	};

	return { cwd, scenarios };
};

/** The same attributable forge, with a failed job that printed far more than a repair attempt may be handed. */
const setupOversizedLog = async () => {
	const cwd = await freshCwd();
	const oversized = Array.from({ length: 400 }, () => `unit\t${'noise '.repeat(15)}`).join('\n');

	stubForgeOnPath({ responses: { ...attributableForge(), 'run view 77 --log-failed': { stdout: oversized } } });

	return { cwd };
};

const readEachScenario = async ({ cwd, scenarios }: { cwd: string; scenarios: Record<string, ForgeTable> }) => {
	const outcomes: Record<string, CheckFailure[] | undefined> = {};

	for (const [scenario, responses] of Object.entries(scenarios)) {
		stubForgeOnPath({ responses });

		outcomes[scenario] = await readCheckFailureLogs({ prNumber: 41, commit: candidateCommit, failingChecks: ['unit'], cwd });
	}

	return outcomes;
};

describe('readCheckFailureLogs', () => {
	test('reads only attributable CI failure evidence', async () => {
		const { cwd, scenarios } = await setupForgeScenarios();

		const outcomes = await readEachScenario({ cwd, scenarios });

		expect(outcomes).toEqual({
			attributable: [
				expect.objectContaining({
					name: 'unit',
					runId: 77,
					commit: candidateCommit,
					output: expect.stringContaining('AssertionError: expected 3 to be 4'),
				}),
			],
			pullRequestHeadMoved: undefined,
			wrongPullRequestHead: undefined,
			foreignProviderCheck: undefined,
			ambiguousRuns: undefined,
			runOnAnotherCommit: undefined,
			malformedRunMetadata: undefined,
			unreadableLogs: undefined,
		});
	});

	test('caps an oversized failed job log and says where it was cut', async () => {
		const { cwd } = await setupOversizedLog();

		const failures = await readCheckFailureLogs({ prNumber: 41, commit: candidateCommit, failingChecks: ['unit'], cwd });

		// past the cap a model reads noise rather than a cause, and a silent cut
		// would read as a run that simply stopped there
		expect(failures?.[0]?.output?.endsWith(truncationMarker)).toBe(true);
		expect(failures?.[0]?.output).toHaveLength(32_000 + truncationMarker.length);
	});
});
