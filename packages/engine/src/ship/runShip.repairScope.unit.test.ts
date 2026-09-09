import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runShip } from '#src/ship/index.ts';
import { report } from '#tests/helpers/report.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

// A scenario of its own because what it pins is what the repair attempt is
// SCOPED by, which nothing else asks about: the branch's own diff, captured
// once from the clean starting HEAD and handed to the agent beside the failing
// run's output. Everything here is real — a real worktree, a real bare origin,
// the real gates the fixture configures, the real check reader and the real
// evidence reader — with only `gh` stubbed on PATH, because the forge is the
// one collaborator that would leave the machine.

const branch = 'lo-89-ship';

/** The pull request the branch already has, so both attempts meet the same one rather than opening a second. */
const openPullRequest = JSON.stringify({
	number: 41,
	url: 'https://forge.example/acme/repo/pull/41',
	title: 'Centralize ship integration',
	headRefName: branch,
});

/** The check rollup for the pushed candidate: one Actions check whose job link is what ties it to a run. */
const rollup = JSON.stringify({
	headRefOid: '__HEAD__',
	statusCheckRollup: [{ __typename: 'CheckRun', name: 'unit', conclusion: 'FAILURE', detailsUrl: 'https://github.com/acme/repo/actions/runs/77/job/5' }],
});

/** That run's own account of itself: built from the candidate, and failed in the job the check names. */
const failedRun = JSON.stringify({ headSha: '__HEAD__', conclusion: 'failure', attempt: 1, jobs: [{ databaseId: 5, name: 'unit', conclusion: 'failure' }] });

const mergedState = JSON.stringify({
	state: 'MERGED',
	mergeCommit: { oid: '0f1e2d3c' },
	headRefOid: '__HEAD__',
	mergeStateStatus: 'CLEAN',
	reviewDecision: null,
});

/** The rows `gh pr checks` prints for one check in the bucket asked for. */
const checkRows = ({ bucket }: { bucket: 'fail' | 'pass' }) => JSON.stringify([{ name: 'unit', state: bucket === 'fail' ? 'FAILURE' : 'SUCCESS', bucket }]);

/** The one line of the failed job's output a repair is given, as `gh` prefixes it with the job it came from. */
const failedJobLog = 'unit\tAssertionError: expected 3 to be 4\n';

interface SetupParams {
	/** Give the branch a commit whose diff is longer than the cap a repair prompt puts on it. */
	oversizedDiff?: boolean;
}

/**
 * A branch whose first candidate fails CI and whose repaired second candidate
 * passes it.
 *
 * The forge answers red checks on the first wait and green on the second, so
 * one ship spends two complete attempts: the first pushes a candidate and reads
 * the failing run's own output, and the second hands that evidence to the agent
 * before rebuilding, verifying and merging what the repair produced.
 */
const setupRepair = ({ oversizedDiff = false }: SetupParams = {}) => {
	const { cwd } = setupBranchRepo({ branch });

	if (oversizedDiff) {
		writeFileSync(join(cwd, 'generated.txt'), `${'x'.repeat(40_000)}\n`);
		execSync('git add -A && git commit -qm "a large generated addition"', { cwd, stdio: 'ignore' });
	}

	stubForgeOnPath({
		responses: {
			'auth status': { exitCode: 0 },
			'pr list': { stdout: `[${openPullRequest}]` },
			// The rollup read must be listed before the bare head read: the stub
			// answers on the first prefix an invocation starts with.
			'pr view 41 --json headRefOid,statusCheckRollup': { stdout: rollup },
			'pr view 41 --json headRefOid': { stdout: '{"headRefOid":"__HEAD__"}' },
			'pr view 41 --json state': { stdout: mergedState },
			'pr checks': [{ stdout: checkRows({ bucket: 'fail' }) }, { stdout: checkRows({ bucket: 'pass' }) }],
			'run view 77 --json': { stdout: failedRun },
			'run view 77 --log-failed': { stdout: failedJobLog },
			'pr merge': { exitCode: 0 },
		},
	});

	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);
			writeFileSync(join(cwd, 'feature.md'), '# feature, repaired for the runner\n');

			return { text: report(), exitCode: 0 };
		},
	};

	const ship = () => runShip({ cwd, settings: shipSettingsFixture(), integration: shipIntegrationFixture({ driver }) });

	return { invocations, ship };
};

describe('runShip', () => {
	test('scopes a CI repair by the branch’s own diff and ticket, alongside the failing run’s output', async () => {
		const { invocations, ship } = setupRepair();

		const result = await ship();

		const repair = invocations[0];

		expect(result.status).toBe('shipped');
		// one spawn, and it is the repair: the first attempt's gates were green
		expect(invocations).toHaveLength(1);
		// what the branch set out to do rides the attempt's own prompt beside the
		// evidence, so the agent has both the defect and the bound on fixing it
		expect(repair?.prompt).toContain('# What this branch set out to do');
		expect(repair?.prompt).toContain('+# feature');
		expect(repair?.prompt).toContain('AssertionError: expected 3 to be 4');
		// and the ticket rides the cached half, because it is the same on every attempt
		expect(repair?.systemPrompt).toContain('Ticket lo-89');
	});

	test('caps the branch diff it hands a repair, so a long branch cannot swamp the evidence', async () => {
		const { invocations, ship } = setupRepair({ oversizedDiff: true });

		const result = await ship();

		expect(result.status).toBe('shipped');
		expect(invocations[0]?.prompt).toContain("truncated: the branch's diff is longer than this");
		expect(invocations[0]?.prompt).toContain('AssertionError: expected 3 to be 4');
	});
});
