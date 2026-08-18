import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import { PhaseReport, type RunManifest, RunStatus } from '@/contracts';
import type { Driver } from '@/drivers';
import { runPhasesPipeline } from '@/phases';
import { RunLockError, readRunManifest, writeRunManifest } from '@/runState';

/**
 * A consumer repo holding a plan folder: an overview whose Phases table names
 * one file per phase, plus the phase files themselves. Each phase file carries
 * its own sentinel, so a stub agent can tell which phase it was handed.
 */
const setupPhasedRepo = ({ phases, duplicate = false }: { phases: number; duplicate?: boolean }) => {
	const dir = setupConsumerRepo();
	const folder = join(dir, 'plans', 'demo');
	const rows = Array.from({ length: phases }, (_, index) => `| ${index + 1} | \`phase${duplicate ? 1 : index + 1}.md\` | scope |`);

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'overview.md'), `# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n${rows.join('\n')}\n`);

	for (let phase = 1; phase <= phases; phase += 1) {
		writeFileSync(join(folder, `phase${phase}.md`), `# Feature — Phase ${phase}\n\nPHASE-${phase}-SENTINEL\n`);
	}

	return { dir, overviewPath: join('plans', 'demo', 'overview.md') };
};

/**
 * A stub harness that implements each phase for real (a source file per phase,
 * a test file per source file) and pushes the phase number it was handed onto
 * `seen`. `failAt` returns a failed report for that phase; `parkAt` reports a
 * rate limit instead.
 */
const createPhaseDriver = ({
	dir,
	seen,
	failAt,
	parkAt,
	usage,
}: {
	dir: string;
	seen: number[];
	failAt?: number;
	parkAt?: number;
	usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number };
}): Driver => ({
	name: 'stub',
	invoke: async ({ prompt, systemPrompt }) => {
		const role = roleOf(prompt);

		if (role === 'standards-review') {
			return { text: reviewReport(), exitCode: 0 };
		}

		if (role === 'write-tests') {
			const target = /- (\S+)/.exec(prompt)?.[1] ?? 'unknown.js';
			const testFile = `test/${basename(target, '.js')}.test.js`;

			mkdirSync(join(dir, 'test'), { recursive: true });
			writeFileSync(join(dir, testFile), '// stub test\n');

			return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0, usage };
		}

		if (role !== 'implement') {
			return { text: report(), exitCode: 0, usage };
		}

		const phase = Number(/PHASE-(\d+)-SENTINEL/.exec(systemPrompt ?? '')?.[1] ?? 0);

		seen.push(phase);

		if (phase === parkAt) {
			return { text: '', exitCode: 1, rateLimited: true };
		}

		if (phase === failAt) {
			return { text: report({ status: 'failed', failures: [`PHASE-${phase}-FAILURE`] }), exitCode: 0, usage };
		}

		writeFileSync(join(dir, `src/phase${phase}.js`), `export const phase${phase} = ${phase};\n`);

		return { text: report({ changedFiles: [{ path: `src/phase${phase}.js`, summary: 'feature' }] }), exitCode: 0, usage };
	},
});

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

/** The per-phase run behind each coordinator step, in phase order. */
const readChildren = ({ cwd, manifest }: { cwd: string; manifest: RunManifest }) =>
	Promise.all(manifest.steps.map((step) => readRunManifest({ cwd, runId: PhaseReport.parse(step.report).runId })));

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
		config: await loadConfig({ cwd: dir }),
		overviewPath,
		skipRefactor: true,
		onProgress: (message) => progress.push(message),
	});

	expect(result.ok).toBe(true);
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
	// the sequence's changed files are the union of its phases'
	expect(result.manifest.changedFiles.includes('src/phase1.js')).toBeTruthy();
	expect(result.manifest.changedFiles.includes('src/phase2.js')).toBeTruthy();
	expect(progress.includes('phase 1/2: phase1.md')).toBeTruthy();
	expect(progress.includes('phase 2/2: phase2.md')).toBeTruthy();
});

test('runPhasesPipeline: the sequence report carries its phases tokens, cost, and working time', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const result = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen: [], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 7, cacheCreationTokens: 3, costUsd: 0.25 } }),
		config: await loadConfig({ cwd: dir }),
		overviewPath,
		skipRefactor: true,
	});
	const children = await readChildren({ cwd: dir, manifest: result.manifest });

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
		config: await loadConfig({ cwd: dir }),
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
		config: await loadConfig({ cwd: dir }),
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
	const config = await loadConfig({ cwd: dir });
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
			config: await loadConfig({ cwd: dir }),
			overviewPath,
			skipRefactor: true,
		}),
	});

	// the lock conflict reaches the caller as itself, never as a recorded failure
	expect(error).toBeInstanceOf(RunLockError);

	const [runId] = readdirSync(join(dir, '.lightsout', 'runs'));
	const manifest = await readRunManifest({ cwd: dir, runId });

	expect(manifest.steps[0]?.status).toBe('running');
	// no attempt was spent and no failure was written — the sequence stays exactly resumable
	expect(manifest.steps[0]?.attempts).toBe(0);
	expect(manifest.steps[0]?.error).toBe(undefined);
});

test('runPhasesPipeline: a phase whose own run already passed is adopted on resume, never bought twice', async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 1 });
	const config = await loadConfig({ cwd: dir });
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
	const config = await loadConfig({ cwd: dir });
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
	const config = await loadConfig({ cwd: dir });
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
