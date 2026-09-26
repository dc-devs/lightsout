import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import { integrateDefaultBranch } from '#src/ship/integration/integrateDefaultBranch.ts';
import type { ResolvedStandards } from '#src/standards/ResolvedStandards.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { report } from '#tests/helpers/report.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// Git is not stubbed: these tests check the branch's real state after a merge and a rollback.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();

jest.mock('#src/gates/runGates.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
// -------------------------
const mockResolveStandards = jest.fn<(params: { cwd: string; packages: string[] }) => Promise<ResolvedStandards>>();

jest.mock('#src/standards/resolveStandards.ts', () => ({
	resolveStandards: (params: { cwd: string; packages: string[] }) => mockResolveStandards(params),
}));
// -------------------------

const branch = 'lo-89-ship';

/** The one file both branches edit, so merging the default branch in has to conflict. */
const conflictPath = 'shared.ts';

const author = '-c user.name=t -c user.email=t@t';

const green: GateRunResult = { error: undefined, failedFamilies: [], crashes: [], timeouts: [], coordination: undefined };

const red: GateRunResult = { error: 'test: 2 failing', failedFamilies: ['test'], crashes: [], timeouts: [], coordination: undefined };

const git = ({ cwd, command }: { cwd: string; command: string }) => execSync(`git ${command}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const readHead = ({ cwd }: { cwd: string }) => git({ cwd, command: 'rev-parse HEAD' }).trim();

const readBranch = ({ cwd }: { cwd: string }) => git({ cwd, command: 'rev-parse --abbrev-ref HEAD' }).trim();

const readSubject = ({ cwd }: { cwd: string }) => git({ cwd, command: 'log -1 --pretty=%s' }).trim();

/** The parents of the commit at `HEAD` — two of them is what makes a commit the merge commit. */
const readParents = ({ cwd }: { cwd: string }) => git({ cwd, command: 'rev-list -1 --parents HEAD' }).trim().split(' ').slice(1);

/** How many commits the branch itself gained, following first parents so the merged-in history is not counted. */
const countBranchCommits = ({ cwd, since }: { cwd: string; since: string }) =>
	Number(git({ cwd, command: `rev-list --count --first-parent ${since}..HEAD` }).trim());

const readDirtyPaths = ({ cwd }: { cwd: string }) => git({ cwd, command: 'status --porcelain' }).trim();

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

/** A path no checkout stands on, so every git command fails to start, with a harness that must never be spawned. */
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
		expect(countBranchCommits({ cwd, since: baselineCommit })).toBe(1);
		expect(readParents({ cwd })).toHaveLength(2);
		expect(readSubject({ cwd })).toMatch(/^Merge /);
		expect(git({ cwd, command: `show HEAD:${conflictPath}` })).toContain('feature and default');
		expect({ dirty: readDirtyPaths({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ dirty: '', openMerge: false });
		expect(invocations).toHaveLength(1);
	});

	test('restores before returning, so an exhausted recovery leaves nothing half-done', async () => {
		const { cwd, baselineCommit, integrate } = setupIntegration({ defaultBranchEdit: 'unrelated', gateRuns: [red] });

		const failure = await integrate();

		expect(failure).toEqual(expect.objectContaining({ reason: 'integration-gates-failed' }));
		expect(readHead({ cwd })).toBe(baselineCommit);
		expect({ dirty: readDirtyPaths({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ dirty: '', openMerge: false });
	});

	test('blocks a crashed gate under its own reason, spawns no repair and restores the baseline', async () => {
		const { cwd, baselineCommit, invocations, integrate } = setupIntegration({
			defaultBranchEdit: 'unrelated',
			gateRuns: [
				{
					error: 'test: exited 139 with no verdict',
					failedFamilies: [],
					crashes: ['test crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.'],
					timeouts: [],
					coordination: undefined,
				},
			],
			uncalledDriver: true,
		});

		const failure = await integrate();

		expect(failure).toEqual(
			expect.objectContaining({
				reason: 'integration-gates-crashed',
				paths: [],
				detail: expect.stringContaining('test crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.'),
			}),
		);
		expect(invocations).toStrictEqual([]);
		expect(mockRunGates).toHaveBeenCalledTimes(1);
		expect(readHead({ cwd })).toBe(baselineCommit);
		expect({ dirty: readDirtyPaths({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ dirty: '', openMerge: false });
	});

	test('blocks a timed-out gate under its own reason, spawns no repair and restores the baseline', async () => {
		const { cwd, baselineCommit, invocations, integrate } = setupIntegration({
			defaultBranchEdit: 'unrelated',
			gateRuns: [
				{
					error: 'test-e2e: exit -1 (timeout at the 15-minute ceiling)',
					failedFamilies: [],
					crashes: [],
					timeouts: ['test-e2e timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.'],
					coordination: undefined,
				},
			],
			uncalledDriver: true,
		});

		const failure = await integrate();

		expect(failure).toEqual(
			expect.objectContaining({
				reason: 'integration-gates-timed-out',
				paths: [],
				detail: expect.stringContaining('test-e2e timed out: every attempt ran past the 15-minute gate ceiling'),
			}),
		);
		expect(invocations).toStrictEqual([]);
		expect(mockRunGates).toHaveBeenCalledTimes(1);
		expect(readHead({ cwd })).toBe(baselineCommit);
		expect({ dirty: readDirtyPaths({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ dirty: '', openMerge: false });
	});

	test('guards failures after mutation and refuses rollback of unrelated git state', async () => {
		const standardsFailure = setupIntegration({ defaultBranchEdit: 'unrelated', standardsThrows: true, uncalledDriver: true });

		const blocked = await standardsFailure.integrate();

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

		expect(failure).toStrictEqual({
			reason: 'integration-unavailable',
			detail: 'git could not fetch origin: git did not answer',
			paths: [],
		});
		expect(mockRunGates).not.toHaveBeenCalled();
	});
});
