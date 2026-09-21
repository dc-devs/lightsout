import { execSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PhaseReport, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { runPhasesPipeline } from '#src/phases/index.ts';
import { listRunIds, RunLockError, readRunManifest, writeRunManifest } from '#src/runState/index.ts';
import { createPhaseDriver } from '#tests/helpers/createPhaseDriver.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { readPhaseChildRuns } from '#tests/helpers/readPhaseChildRuns.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { setupPhasedRepo } from '#tests/helpers/setupPhasedRepo.ts';

/** Field-wise sum of what the per-phase runs actually recorded — the number the sequence report must show. */
const totalUsage = ({ children }: { children: RunManifest[] }) =>
	children.reduce(
		(total, child) => ({
			invocations: total.invocations + (child.usage?.invocations ?? 0),
			inputTokens: total.inputTokens + (child.usage?.inputTokens ?? 0),
			outputTokens: total.outputTokens + (child.usage?.outputTokens ?? 0),
			cacheReadTokens: total.cacheReadTokens + (child.usage?.cacheReadTokens ?? 0),
			cacheCreationTokens: total.cacheCreationTokens + (child.usage?.cacheCreationTokens ?? 0),
			costUsd: total.costUsd + (child.usage?.costUsd ?? 0),
		}),
		{ invocations: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
	);

/** A phased repo whose own commits can succeed: a repo-level identity, because a CI runner has no global one, and run state kept out of `git add -A`. */
const setupCommittablePhasedRepo = ({ phases }: { phases: number }) => {
	const phased = setupPhasedRepo({ phases });

	writeFileSync(join(phased.dir, '.gitignore'), '.lightsout/\n');
	execSync('git config user.name t && git config user.email t@t && git add -A && git commit -qm ignore', { cwd: phased.dir, stdio: 'ignore' });

	return phased;
};

/** Permission bits do not apply to root, so the fs failure they provoke is unreachable there. */
const skipAsRoot = process.getuid?.() === 0;
// Jest has no per-call `{ skip }` option, so the choice is made at the call site.
const testUnlessRoot = skipAsRoot ? test.skip : test;

// A directory made read-only mid-test must be writable again, or the temp tree
// cannot be removed. Recorded at file scope so one hook restores it.
let lockedStateDir: string | undefined;

afterEach(() => {
	if (lockedStateDir) {
		chmodSync(lockedStateDir, 0o755);
		lockedStateDir = undefined;
	}
});

test('runPhasesPipeline: a fresh sequence runs every phase in the overview order and ends passed', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const seen: number[] = [];
	const progress: string[] = [];
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen }),
		config: await readConfig({ cwd: dir }),
		overviewPath,
		skipRefactor: true,
		onProgress: (message) => progress.push(message),
	});

	// the error rides along so a failure says why, rather than only that it failed
	expect({ ok: result.ok, error: result.error }).toStrictEqual({ ok: true, error: undefined });
	// written order, one per phase, no repeats
	expect(seen).toStrictEqual([1, 2]);
	expect(result.manifest.status).toBe('passed');
	expect(result.manifest.pipeline).toBe('phases');
	expect(result.manifest.plan).toBe(overviewPath);
	expect(result.manifest.currentStep).toBe(null);
	expect(result.manifest.steps.map((step) => step.id)).toStrictEqual(['phase1.md', 'phase2.md']);
	expect(result.manifest.steps.map((step) => step.status)).toStrictEqual(['passed', 'passed']);
	// every step names the per-phase run that implemented it
	expect(result.manifest.steps.every((step) => PhaseReport.safeParse(step.report).success)).toBeTruthy();
	// and each of those runs records the coordinator on its own manifest, so a
	// reader never has to reconstruct the link by opening every other run
	expect((await readPhaseChildRuns({ cwd: dir, manifest: result.manifest })).map((child) => child.parentRunId)).toStrictEqual([
		result.manifest.runId,
		result.manifest.runId,
	]);
	// the sequence's changed files are the union of its phases'
	expect(result.manifest.changedFiles.includes('src/phase1.js')).toBeTruthy();
	expect(result.manifest.changedFiles.includes('src/phase2.js')).toBeTruthy();
	expect(progress.includes('phase 1/2: phase1.md')).toBeTruthy();
	expect(progress.includes('phase 2/2: phase2.md')).toBeTruthy();
});

test('runPhasesPipeline: the coordinator persists its own narration, so a watch between phases has something to say', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const progress: string[] = [];
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen: [] }),
		config: await readConfig({ cwd: dir }),
		overviewPath,
		skipRefactor: true,
		onProgress: (message) => progress.push(message),
	});
	const logged = readFileSync(join(runDirFor({ cwd: dir, runId: result.manifest.runId }), 'progress.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line): { at: string; message: string } => JSON.parse(line));

	// the coordinator holds no RunState, so its narration is teed at the one
	// place it narrates — and the caller still hears every line unchanged
	expect(logged.map((entry) => entry.message)).toStrictEqual(progress);
	expect(logged.some((entry) => entry.message === 'phase 1/2: phase1.md')).toBe(true);
	expect(logged.every((entry) => entry.at !== '')).toBe(true);
});

test('runPhasesPipeline: the ship stamp lands on the coordinator alone, never on a phase run', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen: [] }),
		config: await readConfig({ cwd: dir }),
		overviewPath,
		skipRefactor: true,
		willShip: true,
	});
	const children = await readPhaseChildRuns({ cwd: dir, manifest: result.manifest });

	// only the coordinator ships — a phase run carrying the stamp would draw a
	// ship row nothing will ever fill
	expect(result.manifest.willShip).toBe(true);
	expect(children.map((child) => child.willShip)).toStrictEqual([undefined, undefined]);
});

test('runPhasesPipeline: the sequence report carries its phases tokens, cost, and working time', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen: [], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 7, cacheCreationTokens: 3, costUsd: 0.25 } }),
		config: await readConfig({ cwd: dir }),
		overviewPath,
		skipRefactor: true,
	});
	const children = await readPhaseChildRuns({ cwd: dir, manifest: result.manifest });

	expect(result.ok).toBe(true);
	// an overnight run's report must show what the whole sequence cost
	expect(result.manifest.usage).toStrictEqual(totalUsage({ children }));
	expect(result.manifest.usage?.invocations).toBeGreaterThan(0);
	// each phase's time is its child's working time, not the coordinator's wall clock
	expect(result.manifest.steps.map((step) => step.durationMs)).toStrictEqual(
		children.map((child) => child.steps.reduce((total, step) => total + (step.durationMs ?? 0), 0)),
	);
});

test('runPhasesPipeline: a phase that ends short stops the sequence right there and names the resume command', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 3 });
	const seen: number[] = [];
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen, failAt: 2 }),
		config: await readConfig({ cwd: dir }),
		overviewPath,
		skipRefactor: true,
	});

	expect(result.ok).toBe(false);
	// phase 3 was never attempted
	expect(seen).toStrictEqual([1, 2]);
	expect(result.manifest.status).toBe('failed');
	expect(result.manifest.steps.map((step) => step.status)).toStrictEqual(['passed', 'failed', 'pending']);
	expect(result.error ?? '').toMatch(/phase 2\/3 \(phase2\.md\) ended failed/);
	expect((result.error ?? '').includes(`resume with: lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	// the phase's own failure text rides along
	expect(result.error ?? '').toMatch(/PHASE-2-FAILURE/);
});

test('runPhasesPipeline: --start-phase records the earlier phases as done outside the sequence and never runs them', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const seen: number[] = [];
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen }),
		config: await readConfig({ cwd: dir }),
		overviewPath,
		startPhase: 2,
		skipRefactor: true,
	});

	expect(result.ok).toBe(true);
	expect(seen).toStrictEqual([2]);
	// adopted, not implemented: passed with nothing spent on it
	expect(result.manifest.steps[0]).toStrictEqual({ id: 'phase1.md', status: 'passed', attempts: 0 });
});

test('runPhasesPipeline: resume skips the passed phases and continues the interrupted phase in its own run', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const config = await readConfig({ cwd: dir });
	const parked = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen: [], parkAt: 2 }),
		config,
		overviewPath,
		skipRefactor: true,
	});

	expect(parked.manifest.status).toBe('paused-rate-limit');

	const parkedChild = PhaseReport.parse(parked.manifest.steps[1]?.report).runId;
	const seen: number[] = [];
	const resumed = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen }),
		config,
		existing: await readRunManifest({ cwd: dir, runId: parked.manifest.runId }),
		skipRefactor: true,
	});

	expect(resumed.ok).toBe(true);
	// the passed phase is not re-bought; the interrupted one continues
	expect(seen).toStrictEqual([2]);
	expect(resumed.manifest.status).toBe('passed');
	expect(resumed.manifest.runId).toBe(parked.manifest.runId);
	// the interrupted phase resumed its own run rather than starting a second one
	expect(PhaseReport.parse(resumed.manifest.steps[1]?.report).runId).toBe(parkedChild);
	expect(resumed.manifest.steps[1]?.attempts).toBe(2);
});

test('runPhasesPipeline: a live run lock stops the sequence untouched — nothing ran, so nothing is recorded', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });

	mkdirSync(join(dir, '.lightsout'), { recursive: true });
	writeFileSync(join(dir, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));

	const error = await getRejectionError({
		promise: runPhasesPipeline({
			cwd: dir,
			driver: createPhaseDriver({ dir, seen: [] }),
			config: await readConfig({ cwd: dir }),
			overviewPath,
			skipRefactor: true,
		}),
	});

	// the lock conflict reaches the caller as itself, never as a recorded failure
	expect(error).toBeInstanceOf(RunLockError);

	const [runId] = await listRunIds({ cwd: dir });
	const manifest = await readRunManifest({ cwd: dir, runId });

	expect(manifest.steps[0]?.status).toBe('running');
	// no attempt was spent and no failure was written — the sequence stays exactly resumable
	expect(manifest.steps[0]?.attempts).toBe(0);
	expect(manifest.steps[0]?.error).toBe(undefined);
});

test('runPhasesPipeline: a phase whose own run already passed is adopted on resume, never bought twice', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 1 });
	const config = await readConfig({ cwd: dir });
	const passed = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [] }), config, overviewPath, skipRefactor: true });
	// a crash between the phase finishing and the coordinator recording it: the
	// step still says running, but the run it names is done
	const crashed = await writeRunManifest({
		cwd: dir,
		manifest: {
			...passed.manifest,
			status: RunStatus.Running,
			currentStep: 'phase1.md',
			steps: passed.manifest.steps.map((step) => ({ ...step, status: RunStatus.Running })),
		},
	});
	const seen: number[] = [];

	const resumed = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen }), config, existing: crashed, skipRefactor: true });

	expect(resumed.ok).toBe(true);
	// no agent ran, and the phase's own run id is still the record
	expect(seen).toStrictEqual([]);
	expect(resumed.manifest.status).toBe('passed');
	expect(resumed.manifest.steps[0]?.status).toBe('passed');
	expect(PhaseReport.parse(resumed.manifest.steps[0]?.report).runId).toBe(PhaseReport.parse(passed.manifest.steps[0]?.report).runId);
});

test('runPhasesPipeline: a step naming a run that is gone re-runs the phase in a new run', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 1 });
	const config = await readConfig({ cwd: dir });
	const passed = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [] }), config, overviewPath, skipRefactor: true });
	const orphaned = await writeRunManifest({
		cwd: dir,
		manifest: {
			...passed.manifest,
			status: RunStatus.Failed,
			steps: passed.manifest.steps.map((step) => ({ ...step, status: RunStatus.Running, report: { runId: 'deleted-child-run' } })),
		},
	});
	const seen: number[] = [];

	const resumed = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen }), config, existing: orphaned, skipRefactor: true });

	expect(resumed.ok).toBe(true);
	// an unreadable child settles nothing, so the phase is implemented again
	expect(seen).toStrictEqual([1]);
	expect(resumed.manifest.steps[0]?.status).toBe('passed');
	expect(PhaseReport.parse(resumed.manifest.steps[0]?.report).runId).not.toBe('deleted-child-run');
});

testUnlessRoot('runPhasesPipeline: a phase that throws for a reason other than the lock is recorded as that phase failing', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 1 });
	const config = await readConfig({ cwd: dir });
	const parked = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [], parkAt: 1 }), config, overviewPath, skipRefactor: true });
	const stateDir = join(dir, '.lightsout');

	// the run state directory turns read-only between the park and the resume,
	// so the phase's own run cannot even write its lock file
	chmodSync(stateDir, 0o555);
	lockedStateDir = stateDir;

	const resumed = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [] }), config, existing: parked.manifest, skipRefactor: true });

	expect(resumed.ok).toBe(false);
	expect(resumed.manifest.status).toBe('failed');
	expect(resumed.manifest.steps[0]?.status).toBe('failed');
	// the reason is recorded against the phase, not swallowed
	expect(resumed.manifest.steps[0]?.error ?? '').toMatch(/EACCES/);
	expect(resumed.error ?? '').toMatch(/EACCES/);
});

test("hands a fresh sequence's run id to its coordinator and never to a phase's run", async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen: [] }),
		config: await readConfig({ cwd: dir }),
		overviewPath,
		runId: 'pre-minted-sequence-run',
		skipRefactor: true,
	});
	const children = await readPhaseChildRuns({ cwd: dir, manifest: result.manifest });

	// the caller named the run before it started, so the record that names it
	// points at the coordinator that exists
	expect(result.manifest.runId).toBe('pre-minted-sequence-run');
	// a phase's own run mints its own id under the parent link — a child sharing
	// the coordinator's id would overwrite the coordinator's manifest
	expect(children.map((child) => child.runId).includes('pre-minted-sequence-run')).toBe(false);
	expect(children.map((child) => child.parentRunId)).toStrictEqual(['pre-minted-sequence-run', 'pre-minted-sequence-run']);
});

test("gathers every phase's commit onto the coordinator manifest", async () => {
	const { dir, overviewPath } = setupCommittablePhasedRepo({ phases: 2 });
	const config = await readConfig({ cwd: dir });

	const result = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [] }), config, overviewPath, skipRefactor: true });
	const children = await readPhaseChildRuns({ cwd: dir, manifest: result.manifest });

	// one entry per phase, in phase order, each naming the phase's own run — a coordinator that commits nothing itself still reports what the sequence left
	expect(result.manifest.commits.map((commit) => commit.runId)).toStrictEqual(children.map((child) => child.runId));
	expect(result.manifest.commits.map((commit) => commit.subject)).toEqual([expect.stringContaining('phase1'), expect.stringContaining('phase2')]);
	expect(result.manifest.commits.every((commit) => /^[0-9a-f]{7,}$/.test(commit.sha))).toBe(true);
});

test("hands an unstarted phase of a resumed sequence the sequence's own baseline", async () => {
	const { dir, overviewPath } = setupCommittablePhasedRepo({ phases: 2 });
	const config = await readConfig({ cwd: dir });
	const parked = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [], parkAt: 1 }), config, overviewPath, skipRefactor: true });

	const resumed = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [] }), config, existing: parked.manifest, skipRefactor: true });
	const [first, second] = await readPhaseChildRuns({ cwd: dir, manifest: resumed.manifest });

	// phase 2 never started, so it mints its own run — and what it counts as its own is the
	// sequence's set, taken before the sequence began, not a snapshot of a tree somebody sat in
	expect(second?.baselineDirtyFiles.includes('src/phase1.js')).toBe(true);
	expect((first?.changedFiles ?? []).every((path) => second?.baselineDirtyFiles.includes(path))).toBe(true);
});

test("leaves a started phase's own recorded baseline alone", async () => {
	const { dir, overviewPath } = setupCommittablePhasedRepo({ phases: 2 });
	const config = await readConfig({ cwd: dir });
	const parked = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [], parkAt: 2 }), config, overviewPath, skipRefactor: true });
	const [, started] = await readPhaseChildRuns({ cwd: dir, manifest: parked.manifest });

	const resumed = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [] }), config, existing: parked.manifest, skipRefactor: true });
	const [, second] = await readPhaseChildRuns({ cwd: dir, manifest: resumed.manifest });

	// phase 2 already had a run of its own, so it keeps the set that run recorded
	expect(second?.runId).toBe(started?.runId);
	expect(second?.baselineDirtyFiles).toStrictEqual(started?.baselineDirtyFiles);
	expect(second?.baselineDirtyFiles.includes('src/phase1.js')).toBe(false);
});

test("leaves a fresh sequence's phases unguarded", async () => {
	const { dir, overviewPath } = setupCommittablePhasedRepo({ phases: 2 });
	const config = await readConfig({ cwd: dir });

	const result = await runPhasesPipeline({ cwd: dir, driver: createPhaseDriver({ dir, seen: [] }), config, overviewPath, skipRefactor: true });
	const [first, second] = await readPhaseChildRuns({ cwd: dir, manifest: result.manifest });

	// nothing is inherited on a first sequence: phase 2 starts from its own snapshot of the tree phase 1's commit left clean
	expect(first?.changedFiles.includes('src/phase1.js')).toBe(true);
	expect((first?.changedFiles ?? []).some((path) => second?.baselineDirtyFiles.includes(path))).toBe(false);
});
