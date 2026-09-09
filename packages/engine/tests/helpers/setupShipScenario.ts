import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import type { CheckFailure, ChecksSummary } from '#src/ship/forge/index.ts';
import { runShip } from '#src/ship/index.ts';
import { mockShip } from '#tests/helpers/mockShip.ts';
import { report } from '#tests/helpers/report.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipScenarioFixtures } from '#tests/helpers/shipScenarioFixtures.ts';
import { shipScenarioGit } from '#tests/helpers/shipScenarioGit.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';

const { author, branch, conflictPath, green, greenChecks, mergedCommit, pullRequest } = shipScenarioFixtures;
const { advanceDefaultBranch, git, gitOut, headOf, remoteTip } = shipScenarioGit;

/** One answer per turn, the last answering every turn after it — how a forge or a gate that changes its mind between attempts is scripted. */
const answerInTurn = <Value>({ answers, fallback }: { answers: Value[]; fallback: Value }) => {
	let turn = 0;

	return (): Value => {
		const answer = answers[Math.min(turn, answers.length - 1)] ?? fallback;

		turn += 1;

		return answer;
	};
};

/** What the tree looked like when the gates ran — the evidence for what was verified, and for whether it was still uncommitted. */
interface GateView {
	head: string;
	status: string;
}

interface Params {
	/** Files the checkout is left holding at entry, untracked — what a dirty entry looks like. */
	dirty?: Record<string, string>;
	/** Files edited and staged at entry, which is the other half of uncommitted work. */
	staged?: Record<string, string>;
	/** A commit pushed to `origin/main` before ship runs, moving the default branch ahead. */
	defaultBranch?: { path: string; content: string };
	/** Let the feature branch and the default branch add the same file, so the merge has to conflict. */
	conflict?: boolean;
	/** Push the branch to origin before shipping, so the ship meets published history. */
	prePushed?: boolean;
	/** Point origin at a path that does not exist, so the fetch is what fails. */
	brokenOrigin?: boolean;
	/** One answer per gate run; the last answers every run after it. */
	gateRuns?: GateRunResult[];
	/** One answer per check wait; the last answers every wait after it. */
	checkRuns?: ChecksSummary[];
	/** One answer per merge request; the last answers every request after it. */
	mergeRuns?: (string | ShipStepFailure)[];
	/** One answer per CI evidence read; the last answers every read after it. */
	evidenceRuns?: (CheckFailure[] | undefined)[];
	/** What the scripted integrator does to the tree on each spawn. */
	onAttempt?: (params: { cwd: string; attempt: number }) => void;
	/** Something the world does while the gates are running, such as the default branch moving. */
	onGate?: (params: { cwd: string; origin: string; run: number }) => void;
	/** Something the world does while a merge is being requested, such as the default branch moving between attempts. */
	onMerge?: (params: { cwd: string; origin: string; request: number }) => void;
	settings?: Partial<ShipSettings>;
}

/**
 * A real feature branch over a real bare origin, with the gates, the forge and
 * the check wait scripted turn by turn.
 *
 * One factory for the whole family because every scenario is the same sequence
 * meeting a different world: what the default branch did, what the gates said,
 * what the forge answered, and what the agent did about it.
 *
 * Git is real throughout — a real worktree, a real bare origin, real merges,
 * real pushes — because integrating the default branch is the whole subject and
 * a stubbed git would prove none of it. What is stubbed is everything that
 * would either leave the machine or take half an hour. The harness is NOT
 * stubbed away: a scripted driver answers the real contract invoker, so what a
 * recovery attempt was handed is read off the invocation it received.
 */
export const setupShipScenario = ({
	dirty = {},
	staged = {},
	defaultBranch,
	conflict = false,
	prePushed = false,
	brokenOrigin = false,
	gateRuns = [green],
	checkRuns = [greenChecks],
	mergeRuns = [mergedCommit],
	evidenceRuns = [undefined],
	onAttempt = () => undefined,
	onGate = () => undefined,
	onMerge = () => undefined,
	settings = {},
}: Params = {}) => {
	const { cwd, origin } = setupBranchRepo({ branch });

	// The run's own records are ignored the way a consumer repo ignores them.
	// Ship writes its result into `.lightsout/` on every exit path, including the
	// ones that restore the branch — so without this, a restored-clean tree would
	// read as dirty because of the very file that reports it.
	writeFileSync(join(cwd, '.gitignore'), '.lightsout/\n');
	git({ cwd, command: 'add -A' });
	git({ cwd, command: `${author} commit -qm "ignore the run records"` });

	if (conflict) {
		writeFileSync(join(cwd, conflictPath), 'export const value = "feature";\n');
		git({ cwd, command: 'add -A' });
		git({ cwd, command: `${author} commit -qm "the feature adds the shared file"` });
		advanceDefaultBranch({ origin, path: conflictPath, content: 'export const value = "default";\n' });
	}

	const movedTo = defaultBranch === undefined ? undefined : advanceDefaultBranch({ origin, ...defaultBranch });

	if (prePushed) {
		git({ cwd, command: `push -q --set-upstream origin ${branch}` });
	}

	const publishedTip = prePushed ? remoteTip({ cwd }) : '';
	const baseline = headOf({ cwd });

	for (const [path, content] of Object.entries({ ...staged, ...dirty })) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}

	for (const path of Object.keys(staged)) {
		git({ cwd, command: `add ${path}` });
	}

	if (brokenOrigin) {
		git({ cwd, command: 'remote set-url origin /lightsout/no/such/origin' });
	}

	const progress: string[] = [];
	const invocations: DriverInvocation[] = [];
	const gateViews: GateView[] = [];
	const expectedHeads: string[] = [];
	const mergeRequests: Parameters<typeof mockShip.mergePullRequest>[0][] = [];
	const evidenceReads: Parameters<typeof mockShip.readCheckFailureLogs>[0][] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);
			onAttempt({ cwd, attempt: invocations.length });

			return { text: report(), exitCode: 0 };
		},
	};

	const nextGate = answerInTurn({ answers: gateRuns, fallback: green });
	const nextChecks = answerInTurn({ answers: checkRuns, fallback: greenChecks });
	const nextMerge = answerInTurn<string | ShipStepFailure>({ answers: mergeRuns, fallback: mergedCommit });
	const nextEvidence = answerInTurn<CheckFailure[] | undefined>({ answers: evidenceRuns, fallback: undefined });

	mockShip.readGitHeadCommit.mockImplementation(async ({ cwd: repo }) => {
		try {
			return headOf({ cwd: repo });
		} catch {
			return undefined;
		}
	});
	mockShip.readForgeAuth.mockResolvedValue(true);
	mockShip.findPullRequest.mockResolvedValue(undefined);
	mockShip.createPullRequest.mockResolvedValue(pullRequest);
	mockShip.readPullRequestChecks.mockResolvedValue(undefined);
	mockShip.runGates.mockImplementation(async ({ cwd: repo }) => {
		gateViews.push({ head: headOf({ cwd: repo }), status: gitOut({ cwd: repo, command: 'status --porcelain' }) });
		onGate({ cwd, origin, run: gateViews.length });

		return nextGate();
	});
	mockShip.waitForChecks.mockImplementation(async (params) => {
		expectedHeads.push(params.expectedHead);

		return nextChecks();
	});
	mockShip.mergePullRequest.mockImplementation(async (params) => {
		mergeRequests.push(params);
		onMerge({ cwd, origin, request: mergeRequests.length });

		return nextMerge();
	});
	mockShip.readCheckFailureLogs.mockImplementation(async (params) => {
		evidenceReads.push(params);

		return nextEvidence();
	});

	const ship = () =>
		runShip({
			cwd,
			settings: shipSettingsFixture(settings),
			integration: shipIntegrationFixture({ driver }),
			onProgress: (message: string) => progress.push(message),
		});

	return { baseline, cwd, evidenceReads, expectedHeads, gateViews, invocations, mergeRequests, movedTo, origin, progress, publishedTip, ship };
};
