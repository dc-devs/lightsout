import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { committedPaths } from '#tests/helpers/committedPaths.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { headSubject } from '#tests/helpers/headSubject.ts';
import { report } from '#tests/helpers/report.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// The commit the pipeline now ends every unit of work on, read back from real
// git rather than from the manifest that claims it.

/** What `git rev-parse HEAD` answers in a fixture repo. */
const headSha = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd }).toString().trim();

/** The newest commit's message body — where the run id is written. */
const headBody = ({ cwd }: { cwd: string }) => execSync('git log -1 --pretty=%b', { cwd }).toString().trim();

/** Every path git still reports as modified or untracked, so "committed" can be told from "left behind". */
const dirtyPaths = ({ cwd }: { cwd: string }) => execSync('git status --porcelain', { cwd }).toString().split('\n').filter(Boolean);

/**
 * A consumer repo the pipeline can actually commit in.
 *
 * Two things the ordinary fixture has no need of: the run's own records are
 * ignored, so a commit carries the work rather than the manifest describing it,
 * and the repo carries a git identity of its own, because the commit step
 * commits plainly and a CI runner has no global one to borrow.
 */
const setupCommittingRepo = ({ scripts, sources }: { scripts?: Record<string, string | false>; sources?: Record<string, string> } = {}) => {
	const dir = setupConsumerRepo({
		scripts,
		sources: { '.gitignore': '.lightsout/\n', 'src/index.js': 'export const one = 1;\n', ...sources },
	});

	execSync('git config user.name t && git config user.email t@t', { cwd: dir });

	return dir;
};

/** A run whose implement agent writes one real source file and whose other seats report nothing. */
const setupPassingRun = async () => {
	const dir = setupCommittingRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, config: await readConfig({ cwd: dir }) };
};

/** What the stub commit-message agent reports it spent — distinct figures, so the ledger line is plainly this call's. */
const commitMessageSpend = { inputTokens: 21, outputTokens: 8, cacheReadTokens: 340, cacheCreationTokens: 5, costUsd: 0.07 };

/**
 * The passing run again, with its commit-message agent answering on contract.
 *
 * The seat is told apart from the implementer by `roleOf`, so the summary goes
 * only to the call that writes the commit message, and that call alone reports
 * usage — any ledger line carrying these figures can only be its own.
 */
const setupSummarizedRun = async () => {
	const dir = setupCommittingRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				const role = roleOf(prompt);

				if (role === 'commit-message') {
					return { text: JSON.stringify({ summary: 'add the feature' }), exitCode: 0, usage: commitMessageSpend };
				}

				if (role !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};
	const readLedger = ({ runId }: { runId: string }) =>
		readFileSync(join(runDirFor({ cwd: dir, runId }), 'agents.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);

	return { dir, driver, config: await readConfig({ cwd: dir }), readLedger };
};

/** That same run, already finished and committed — the state a resume walks back into. */
const setupLandedRun = async () => {
	const { dir, driver, config } = await setupPassingRun();
	const first = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	return { dir, config, first, landed: headSha({ cwd: dir }) };
};

/** The steps a `--skip-refactor` run declares, each recorded as one an earlier attempt already walked. */
const walkedSteps = [
	'clean-slate',
	'write-ledger-tests',
	'implement',
	'format-implement',
	'verify-implement',
	'write-tests',
	'format-tests',
	'verify-tests',
].map((id) => ({ id, status: RunStatus.Passed, attempts: 1 }));

/**
 * A run re-entered with every step behind it, a clean tree, and not one changed
 * file to its name — the silent agent, caught at the commit rather than at the
 * implement step whose own rule catches it on a first attempt.
 *
 * Its approved copy is on disk and named on the manifest, because what the
 * refusal must leave intact is the baseline a further resume diffs against.
 */
const setupSilentResume = async () => {
	const dir = setupCommittingRepo();
	const runId = 'run-commit-silent-01';
	const approvedPath = 'src/widget.unit.test.js';
	const approvedBody = "test('widget: doubles its input', () => {});\n";
	const approvedCopy = join(runDirFor({ cwd: dir, runId }), 'approved', approvedPath);

	mkdirSync(dirname(approvedCopy), { recursive: true });
	writeFileSync(approvedCopy, approvedBody);

	const existing: RunManifest = {
		runId,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:03.000Z',
		plan: 'plan.md',
		harness: 'stub',
		status: RunStatus.Failed,
		currentStep: null,
		steps: walkedSteps,
		stepOrder: walkedSteps.map((step) => step.id),
		changedFiles: [],
		commits: [],
		packages: [],
		baselineDirtyFiles: [],
		testSubjects: [],
		acceptanceTests: [],
		approvedTests: [{ path: approvedPath, sha256: sha256({ content: approvedBody }), removed: false }],
		unreachableChangedFiles: [],
		coverageExcludedChangedFiles: [],
	};

	return { dir, existing, approvedCopy, config: await readConfig({ cwd: dir }) };
};

/**
 * A gate command that drops a file into the tree, but only once the implement
 * agent has been — the one way a path nothing records gets there.
 *
 * The clean-slate gate run therefore leaves the tree exactly as it found it,
 * which matters: that step folds everything dirty at its end into the run's
 * baseline, and a file already there would be the run's own by the time the
 * commit step looked.
 */
const strayTestCommand = `node -e "const fs = require('fs'); if (fs.existsSync('docs.md')) { fs.writeFileSync('stray.txt', 'x'); }"`;

/**
 * A run that ends holding a file it never recorded.
 *
 * The implement agent changes a doc: real changed-file truth with no testable
 * source in it, so write-tests skips — and the run's last git snapshot skips
 * with it. The gate's file lands after that snapshot, which is what leaves it
 * in the tree owned by nobody. No formatter is configured, because the format
 * step folds whatever the formatter leaves into the baseline.
 */
const setupStrayTreeRun = async () => {
	const dir = setupCommittingRepo({
		scripts: { test: strayTestCommand },
		sources: { 'src/phaseOne.js': 'export const phaseOne = () => 1;\n' },
	});
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				writeFileSync(join(dir, 'docs.md'), '# docs\n');

				return { text: report({ changedFiles: [{ path: 'docs.md', summary: 'docs' }] }), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, config: await readConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test("commits the run's work before stamping it passed", async () => {
		const { dir, driver, config } = await setupPassingRun();

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		// the manifest's entry is checked against what git itself answers, so a
		// recorded commit that never happened cannot read as a pass
		expect({
			passed: result.ok,
			status: result.manifest.status,
			commits: result.manifest.commits,
			carriesTheWork: committedPaths({ cwd: dir }).includes('src/feature.js'),
			namesTheRunInItsBody: headBody({ cwd: dir }).includes(result.manifest.runId),
			leftBehind: dirtyPaths({ cwd: dir }),
		}).toStrictEqual({
			passed: true,
			status: 'passed',
			commits: [{ sha: headSha({ cwd: dir }), subject: headSubject({ cwd: dir }), runId: result.manifest.runId }],
			carriesTheWork: true,
			namesTheRunInItsBody: true,
			// a passing run ends on a tree ship can start from
			leftBehind: [],
		});
	});

	test('fails a run that changed nothing and keeps the approved copies', async () => {
		const { dir, existing, approvedCopy, config } = await setupSilentResume();

		const result = await runImplementPipeline({
			cwd: dir,
			driver: createUncalledDriver({ reason: 'a run whose every step is recorded passed spawns no agent' }),
			config,
			existing,
			skipRefactor: true,
		});

		expect({
			passed: result.ok,
			status: result.manifest.status,
			error: result.error,
			commits: result.manifest.commits,
			// the copies are the baseline a further resume diffs against, so the
			// refusal has to leave them where they are
			approvedCopyKept: existsSync(approvedCopy),
		}).toEqual({
			passed: false,
			status: 'failed',
			error: expect.stringContaining('changed nothing'),
			commits: [],
			approvedCopyKept: true,
		});
	});

	test('resumes straight to the commit and adds none when the work already landed', async () => {
		const { dir, config, first, landed } = await setupLandedRun();

		const resumed = await runImplementPipeline({
			cwd: dir,
			driver: createUncalledDriver({ reason: 'a resumed run whose steps all passed spawns no agent' }),
			config,
			existing: first.manifest,
			skipRefactor: true,
		});

		expect({
			firstRunPassed: first.ok,
			passed: resumed.ok,
			status: resumed.manifest.status,
			// work already in history is not the worker having changed nothing
			commits: resumed.manifest.commits.length,
			head: headSha({ cwd: dir }),
		}).toStrictEqual({ firstRunPassed: true, passed: true, status: 'passed', commits: 1, head: landed });
	});

	test('seeds a run from an inherited baseline and guards it', async () => {
		const { dir, driver, config } = await setupStrayTreeRun();
		const inherited = ['src/phaseOne.js', 'src/usePhaseOne.js'];
		const before = headSha({ cwd: dir });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true, inheritedBaseline: inherited });

		expect({
			// the list the caller handed down, not a snapshot of the tree at start
			baseline: result.manifest.baselineDirtyFiles,
			passed: result.ok,
			status: result.manifest.status,
			// and the guard that list turns on names the file nothing recorded
			error: result.error,
			commits: result.manifest.commits,
			head: headSha({ cwd: dir }),
		}).toEqual({
			baseline: ['src/phaseOne.js', 'src/usePhaseOne.js'],
			passed: false,
			status: 'failed',
			error: expect.stringMatching(/did not make[\s\S]*stray\.txt/),
			commits: [],
			head: before,
		});
	});

	test('leaves a first run unguarded', async () => {
		const { dir, driver, config } = await setupStrayTreeRun();

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect({
			baseline: result.manifest.baselineDirtyFiles,
			passed: result.ok,
			commits: result.manifest.commits.length,
			// the same unrecorded file the resumed run is refused over rides into a
			// first run's commit, which is what "unguarded" means
			carriedTheStrayFile: committedPaths({ cwd: dir }).includes('stray.txt'),
			leftBehind: dirtyPaths({ cwd: dir }),
		}).toStrictEqual({ baseline: [], passed: true, commits: 1, carriedTheStrayFile: true, leftBehind: [] });
	});

	test("commits under the agent's summary and bills the commit-message call to the run", async () => {
		const { dir, driver, config, readLedger } = await setupSummarizedRun();

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const ledger = readLedger({ runId: result.manifest.runId });

		expect({
			passed: result.ok,
			// the engine owns the prefix; the agent's line is what closes the subject
			subjectEndsWithSummary: headSubject({ cwd: dir }).endsWith('add the feature'),
			namesTheRunInItsBody: headBody({ cwd: dir }).includes(`lightsout run ${result.manifest.runId}`),
			commitMessageSpend: ledger.filter((line) => line.step === 'commit-message'),
		}).toEqual({
			passed: true,
			subjectEndsWithSummary: true,
			namesTheRunInItsBody: true,
			commitMessageSpend: [expect.objectContaining({ step: 'commit-message', ...commitMessageSpend })],
		});
	});
});
