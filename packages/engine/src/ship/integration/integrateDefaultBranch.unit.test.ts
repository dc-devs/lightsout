import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { integrateDefaultBranch } from '#src/ship/integration/integrateDefaultBranch.ts';
import type { ResolvedStandards } from '#src/standards/index.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { report } from '#tests/helpers/report.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// The repository's own gates are another module's entry point, covered by its
// own tests, and running real gate commands here would measure the toolchain
// rather than the integration. Git is deliberately NOT stubbed: what this step
// owns is the branch's real state after a merge, a recovery and a rollback, and
// a stubbed git would prove none of it.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
// -------------------------
const mockResolveStandards = jest.fn<(params: { cwd: string; packages: string[] }) => Promise<ResolvedStandards>>();

jest.mock('#src/standards/index.ts', () => ({
	resolveStandards: (params: { cwd: string; packages: string[] }) => mockResolveStandards(params),
}));
// -------------------------

const branch = 'lo-89-ship';

/** The one file both branches edit, so merging the default branch in has to conflict. */
const conflictPath = 'shared.ts';

const author = '-c user.name=t -c user.email=t@t';

const green: GateRunResult = { error: undefined, failedFamilies: [], crashes: [], coordination: undefined };

const red: GateRunResult = { error: 'test: 2 failing', failedFamilies: ['test'], crashes: [], coordination: undefined };

const git = ({ cwd, command }: { cwd: string; command: string }) => execSync(`git ${command}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The commit the checkout stands on right now. */
const readHead = ({ cwd }: { cwd: string }) => git({ cwd, command: 'rev-parse HEAD' }).trim();

/** The branch the checkout stands on right now. */
const readBranch = ({ cwd }: { cwd: string }) => git({ cwd, command: 'rev-parse --abbrev-ref HEAD' }).trim();

/** The subject line of the commit at `HEAD`. */
const readSubject = ({ cwd }: { cwd: string }) => git({ cwd, command: 'log -1 --pretty=%s' }).trim();

/** The parents of the commit at `HEAD` — two of them is what makes a commit the merge commit. */
const readParents = ({ cwd }: { cwd: string }) => git({ cwd, command: 'rev-list -1 --parents HEAD' }).trim().split(' ').slice(1);

/** How many commits the branch itself gained, following first parents so the merged-in history is not counted. */
const countBranchCommits = ({ cwd, since }: { cwd: string; since: string }) =>
	Number(git({ cwd, command: `rev-list --count --first-parent ${since}..HEAD` }).trim());

/** Uncommitted tracked and untracked paths, empty when the tree is clean. */
const readDirtyPaths = ({ cwd }: { cwd: string }) => git({ cwd, command: 'status --porcelain' }).trim();

/** Whether git still has a merge open. */
const hasOpenMerge = ({ cwd }: { cwd: string }) => existsSync(join(cwd, '.git', 'MERGE_HEAD'));

interface SetupParams {
	/** How the remote default branch moved: onto the file the branch also changed, or onto a file it never touched. */
	defaultBranchEdit?: 'conflicting' | 'unrelated';
	/** One entry per gate run, in order; the last entry answers every run after it. */
	gateRuns?: GateRunResult[];
	/** Make standards loading throw — a failure that arrives after the merge already mutated the branch. */
	standardsThrows?: boolean;
	/** What the scripted harness does to the repository on each attempt it is given. */
	onAttempt?: (params: { cwd: string; attempt: number }) => void;
	/** Use a harness that must never be spawned, so a spawn the test denies is loud rather than silent. */
	uncalledDriver?: boolean;
}

/**
 * A feature branch and a real local bare origin whose default branch has moved,
 * with the gates, the standards and the harness scripted around them.
 */
const setupIntegration = ({
	defaultBranchEdit = 'conflicting',
	gateRuns = [green],
	standardsThrows = false,
	onAttempt,
	uncalledDriver = false,
}: SetupParams = {}) => {
	const { cwd } = setupBranchRepo({ branch });

	writeRepoFile({ cwd, path: conflictPath, content: 'export const value = "feature";\n' });
	git({ cwd, command: 'add -A' });
	git({ cwd, command: `${author} commit -qm "the feature edits the shared file"` });
	git({ cwd, command: 'checkout -q main' });

	if (defaultBranchEdit === 'conflicting') {
		writeRepoFile({ cwd, path: conflictPath, content: 'export const value = "default";\n' });
	} else {
		writeRepoFile({ cwd, path: 'untouched.ts', content: 'export const untouched = true;\n' });
	}

	git({ cwd, command: 'add -A' });
	git({ cwd, command: `${author} commit -qm "the default branch moves on"` });
	git({ cwd, command: 'push -q origin main' });
	git({ cwd, command: `checkout -q ${branch}` });

	let gateRun = 0;

	mockRunGates.mockImplementation(async () => {
		const result = gateRuns[Math.min(gateRun, gateRuns.length - 1)] ?? green;
		gateRun += 1;

		return result;
	});
	mockResolveStandards.mockImplementation(async () => {
		if (standardsThrows) {
			throw new Error('the declared standards pack could not be loaded');
		}

		return { standards: '# Standards', channels: [], configured: false, requested: true };
	});

	const invocations: DriverInvocation[] = [];
	let attempt = 0;
	const scripted: Driver = {
		name: 'stub',
		invoke: async () => {
			attempt += 1;
			onAttempt?.({ cwd, attempt });

			return { text: report(), exitCode: 0 };
		},
	};
	const driver = recordingDriver({
		driver: uncalledDriver ? createUncalledDriver({ reason: 'the harness was spawned for a failure that never reaches an agent' }) : scripted,
		invocations,
	});
	const baselineCommit = readHead({ cwd });

	const integrate = () =>
		integrateDefaultBranch({
			cwd,
			integration: shipIntegrationFixture({ driver }),
			branch,
			defaultBranch: 'main',
			baselineCommit,
			preShip: undefined,
		});

	return { cwd, baselineCommit, invocations, integrate };
};

/**
 * A path no checkout stands on, so every git command fails to start rather than
 * answering — the one case where the process says nothing at all.
 *
 * A harness that must never be spawned goes with it: the branch was never
 * mutated, so nothing here may reach an agent or a rollback.
 */
const setupUnreachableCheckout = () => ({
	cwd: join(tmpdir(), 'lightsout-no-such-checkout', 'nowhere'),
	integration: shipIntegrationFixture(),
});

describe('integrateDefaultBranch', () => {
	test('commits the merge, the resolution and the repair together, once, after the gates go green', async () => {
		const { cwd, baselineCommit, invocations, integrate } = setupIntegration({
			onAttempt: ({ cwd: repo }) => {
				writeRepoFile({ cwd: repo, path: conflictPath, content: 'export const value = "feature and default";\n' });
				git({ cwd: repo, command: `add ${conflictPath}` });
			},
		});

		const failure = await integrate();

		expect(failure).toBeUndefined();
		// exactly one commit on the branch, and it is the merge commit itself —
		// the resolution did not land as a commit of its own ahead of it
		expect(countBranchCommits({ cwd, since: baselineCommit })).toBe(1);
		expect(readParents({ cwd })).toHaveLength(2);
		// the message is the one git wrote for the merge, not one the engine composed
		expect(readSubject({ cwd })).toMatch(/^Merge /);
		// the agent's resolution is inside that single commit, and nothing is left over
		expect(git({ cwd, command: `show HEAD:${conflictPath}` })).toContain('feature and default');
		expect({ dirty: readDirtyPaths({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ dirty: '', openMerge: false });
		// one spawn settled the conflict, and green gates asked for no repair spawn
		expect(invocations).toHaveLength(1);
	});

	test('restores before returning, so an exhausted recovery leaves nothing half-done', async () => {
		const { cwd, baselineCommit, integrate } = setupIntegration({ defaultBranchEdit: 'unrelated', gateRuns: [red] });

		const failure = await integrate();

		expect(failure).toEqual(expect.objectContaining({ reason: 'integration-gates-failed' }));
		// the caller is handed the branch exactly as ship found it: back at its
		// baseline, no merge open, nothing uncommitted left behind
		expect(readHead({ cwd })).toBe(baselineCommit);
		expect({ dirty: readDirtyPaths({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ dirty: '', openMerge: false });
	});

	// The ledger states one criterion, and so one test name, for both halves of
	// the guard: a failure arriving after the merge began restores the baseline,
	// and git state this attempt no longer owns is never reset. Each half is
	// arranged and acted separately below.
	test('guards failures after mutation and refuses rollback of unrelated git state', async () => {
		const standardsFailure = setupIntegration({ defaultBranchEdit: 'unrelated', standardsThrows: true, uncalledDriver: true });

		const blocked = await standardsFailure.integrate();

		// standards load after the merge already mutated the branch, so the
		// failure is guarded rather than thrown, and the baseline is restored
		expect(blocked).toStrictEqual({
			reason: 'integration-unavailable',
			detail: "the repository's standards could not be loaded: the declared standards pack could not be loaded",
			paths: [],
		});
		expect(readHead({ cwd: standardsFailure.cwd })).toBe(standardsFailure.baselineCommit);
		expect({ dirty: readDirtyPaths({ cwd: standardsFailure.cwd }), openMerge: hasOpenMerge({ cwd: standardsFailure.cwd }) }).toStrictEqual({
			dirty: '',
			openMerge: false,
		});
		expect(standardsFailure.invocations).toStrictEqual([]);

		const lostOwnership = setupIntegration({
			onAttempt: ({ cwd: repo }) => {
				git({ cwd: repo, command: 'merge --abort' });
				git({ cwd: repo, command: 'checkout -q -b unrelated-work' });
				writeRepoFile({ cwd: repo, path: 'elsewhere.ts', content: 'export const elsewhere = true;\n' });
				git({ cwd: repo, command: 'add -A' });
				git({ cwd: repo, command: `${author} commit -qm "work this ship never owned"` });
			},
		});

		const refused = await lostOwnership.integrate();

		// the branch and the merge this attempt started are gone, so it blocks —
		// and it destroys none of the work that took their place
		expect(refused).toStrictEqual({
			reason: 'integration-unavailable',
			detail: "the integration finished against git state this ship no longer owns: the checkout is on 'unrelated-work' rather than 'lo-89-ship'",
			paths: [],
		});
		expect(readBranch({ cwd: lostOwnership.cwd })).toBe('unrelated-work');
		expect(readSubject({ cwd: lostOwnership.cwd })).toBe('work this ship never owned');
		expect(existsSync(join(lostOwnership.cwd, 'elsewhere.ts'))).toBe(true);
	});

	test('reads the repaired tree for markers of its own, so a green gate cannot carry an unresolved conflict through', async () => {
		const { cwd, baselineCommit, integrate } = setupIntegration({
			defaultBranchEdit: 'unrelated',
			gateRuns: [red, green],
			onAttempt: ({ cwd: repo }) => writeRepoFile({ cwd: repo, path: conflictPath, content: 'export const value = "feature";\n<<<<<<< HEAD\n' }),
		});

		const failure = await integrate();

		// the gates went green on a tree the repair left a marker in, so git's own
		// reading — not the gate result — is what ends the integration
		expect(failure).toStrictEqual({
			reason: 'integration-conflict',
			detail: 'the verified tree still carries unresolved conflicts: shared.ts',
			paths: ['shared.ts'],
		});
		expect(readHead({ cwd })).toBe(baselineCommit);
		expect({ dirty: readDirtyPaths({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ dirty: '', openMerge: false });
	});

	test('leaves the work that replaced the branch untouched when an exhausted repair can no longer restore it', async () => {
		const { cwd, integrate } = setupIntegration({
			defaultBranchEdit: 'unrelated',
			gateRuns: [red],
			onAttempt: ({ cwd: repo, attempt }) => {
				if (attempt > 1) {
					return;
				}

				git({ cwd: repo, command: 'merge --abort' });
				git({ cwd: repo, command: 'checkout -q -b unrelated-work' });
				writeRepoFile({ cwd: repo, path: 'elsewhere.ts', content: 'export const elsewhere = true;\n' });
				git({ cwd: repo, command: 'add -A' });
				git({ cwd: repo, command: `${author} commit -qm "work this ship never owned"` });
			},
		});

		const failure = await integrate();

		// the rollback this failure owes is destructive, so losing the branch it
		// was owed on turns it into a sentence rather than a reset
		expect(failure).toStrictEqual({
			reason: 'integration-gates-failed',
			detail: "test: 2 failing\ngit state this ship no longer owns was left untouched: the checkout is on 'unrelated-work' rather than 'lo-89-ship'",
			paths: ['test'],
		});
		expect(readBranch({ cwd })).toBe('unrelated-work');
		expect(readSubject({ cwd })).toBe('work this ship never owned');
	});

	test('answers a git that never started as unavailable, rather than letting it throw', async () => {
		const { cwd, integration } = setupUnreachableCheckout();

		const failure = await integrateDefaultBranch({
			cwd,
			integration,
			branch,
			defaultBranch: 'main',
			baselineCommit: '0'.repeat(40),
			preShip: undefined,
		});

		// A process that never answered is missing evidence, not an exception: an
		// integration that threw here would leave the caller with no result to
		// write and, in a later step, a merge nobody is left to put back.
		expect(failure).toStrictEqual({
			reason: 'integration-unavailable',
			detail: 'git could not fetch origin: git did not answer',
			paths: [],
		});
		// nothing was mutated, so no rollback and no spawn were owed
		expect(mockRunGates).not.toHaveBeenCalled();
	});
});
