import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { watchRunProgress } from '#src/cli/common/utils/watchRunProgress.ts';
import { type RunManifest, RunStatus, ShipStatus, type StepRecord } from '#src/contracts/index.ts';

/** Beyond any OS pid range — the live-process probe reports it dead. */
const deadPid = 999_999_999;

/** Short enough that a whole watch finishes inside one test, long enough that nothing races. */
const timings = { intervalMs: 20, handoffMs: 40, shipPollMs: 10, shipCeilingMs: 120 };

const manifestOf = ({ runId, ...overrides }: { runId: string } & Partial<RunManifest>): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:10:00.000Z',
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status: RunStatus.Running,
	currentStep: null,
	steps: [{ id: 'implement', status: RunStatus.Running, attempts: 1, durationMs: 1_000 }],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
	...overrides,
});

const stepOf = (overrides: Partial<StepRecord> = {}): StepRecord => ({
	id: 'implement',
	status: RunStatus.Running,
	attempts: 1,
	durationMs: 1_000,
	...overrides,
});

/**
 * A repo whose run state can be rewritten BETWEEN frames.
 *
 * Every frame opens with a blank line, so counting those counts frames — and
 * the count is what drives each rewrite. Driving the state off frames rather
 * than off the clock is what keeps a watch test from turning on how fast the
 * machine is.
 */
const setupWatch = ({ onFrame }: { onFrame?: (frame: number) => void } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-watch-'));
	const lines: string[] = [];
	let frames = 0;

	process.stdout.isTTY = false;
	mkdirSync(join(cwd, '.lightsout', 'runs'), { recursive: true });

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		const line = String(args[0]);

		lines.push(line);

		if (line === '') {
			frames += 1;
			onFrame?.(frames);
		}
	});

	const write = ({ manifest }: { manifest: RunManifest }) => {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest), 'utf8');
	};
	const lock = ({ runId, pid }: { runId: string; pid: number }) =>
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid, runId, startedAt: '2026-01-01T00:00:00.000Z' }), 'utf8');
	const shipResult = ({ branch, status }: { branch: string; status: ShipStatus }) => {
		mkdirSync(join(cwd, '.lightsout', 'ship'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'ship', `${branch}.json`), JSON.stringify({ status, branch, failingChecks: [] }), 'utf8');
	};

	return { cwd, lines, write, lock, shipResult, frameCount: () => frames };
};

/** Each frame as its own block of lines, split on the blank line every frame opens with. */
const framesOf = ({ lines }: { lines: string[] }) => {
	const blocks: string[][] = [];

	for (const line of lines) {
		if (line === '' || blocks.length === 0) {
			blocks.push([]);
		}

		if (line !== '') {
			blocks.at(-1)?.push(line);
		}
	}

	return blocks;
};

describe('watchRunProgress', () => {
	test('a run that has already finished paints exactly one frame', async () => {
		const watch = setupWatch();

		watch.write({ manifest: manifestOf({ runId: 'run-done', status: RunStatus.Passed, steps: [stepOf({ status: RunStatus.Passed })] }) });

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-done', ...timings });

		expect(watch.frameCount()).toBe(1);
	});

	test('a run that finishes after two frames paints three, and the last one shows the end state', async () => {
		const watch = setupWatch({
			onFrame: (frame) => {
				if (frame === 2) {
					watch.write({ manifest: manifestOf({ runId: 'run-live', status: RunStatus.Passed, steps: [stepOf({ status: RunStatus.Passed })] }) });
				}
			},
		});

		watch.write({ manifest: manifestOf({ runId: 'run-live' }) });
		watch.lock({ runId: 'run-live', pid: process.pid });

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-live', ...timings });

		const blocks = framesOf({ lines: watch.lines });

		expect(blocks).toHaveLength(3);
		// the frame a reader keeps is the one that says how the run ended
		expect(blocks.at(-1)?.some((line) => line.includes('passed'))).toBe(true);
	});

	test.each([
		{ label: 'a rate-limit pause', status: RunStatus.PausedRateLimit },
		{ label: 'a budget pause', status: RunStatus.PausedBudget },
		{ label: 'an escalation', status: RunStatus.Escalated },
	])('$label is a last frame — the run is stopped, whatever it is called', async ({ status }) => {
		const watch = setupWatch();

		watch.write({ manifest: manifestOf({ runId: 'run-parked', status }) });
		watch.lock({ runId: 'run-parked', pid: process.pid });

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-parked', ...timings });

		expect(watch.frameCount()).toBe(1);
	});

	test('a running manifest with nothing alive behind it stops after two frames rather than repainting a crash forever', async () => {
		const watch = setupWatch();

		watch.write({ manifest: manifestOf({ runId: 'run-zombie' }) });
		watch.lock({ runId: 'run-zombie', pid: deadPid });

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-zombie', ...timings });

		// one dead frame is a phase boundary; two in a row is a crash
		expect(watch.frameCount()).toBe(2);
	});

	test('a live frame between two dead ones resets the counter, so a healthy sequence is never called a crash', async () => {
		const watch = setupWatch({
			onFrame: (frame) => {
				if (frame === 1) {
					watch.lock({ runId: 'run-seq', pid: process.pid });
				}

				if (frame === 2) {
					watch.lock({ runId: 'run-seq', pid: deadPid });
				}
			},
		});

		watch.write({ manifest: manifestOf({ runId: 'run-seq' }) });
		watch.lock({ runId: 'run-seq', pid: deadPid });

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-seq', ...timings });

		expect(watch.frameCount()).toBe(4);
	});

	test('follow mode moves from a phase’s child run to its coordinator, and ends when neither is going', async () => {
		const coordinator = manifestOf({
			runId: 'run-coord',
			pipeline: 'phases',
			plan: 'plans/demo/overview.md',
			steps: [{ id: 'phase1.md', status: RunStatus.Running, attempts: 1, report: { runId: 'run-child' } }],
			updatedAt: '2026-01-01T00:10:00.000Z',
		});
		const watch = setupWatch({
			onFrame: (frame) => {
				if (frame === 1) {
					watch.write({ manifest: manifestOf({ runId: 'run-child', plan: 'plans/demo/phase1.md', status: RunStatus.Passed }) });
					watch.write({ manifest: { ...coordinator, updatedAt: '2026-01-01T00:20:00.000Z' } });
				}

				if (frame === 2) {
					watch.write({ manifest: { ...coordinator, updatedAt: '2026-01-01T00:30:00.000Z', status: RunStatus.Passed } });
				}
			},
		});

		watch.write({ manifest: coordinator });
		watch.write({ manifest: manifestOf({ runId: 'run-child', plan: 'plans/demo/phase1.md', updatedAt: '2026-01-01T00:15:00.000Z' }) });
		watch.lock({ runId: 'run-child', pid: process.pid });

		await watchRunProgress({ cwd: watch.cwd, ...timings });

		const blocks = framesOf({ lines: watch.lines });

		// during a phase the child is the more recently updated; between phases
		// only the coordinator is going, and after it nothing is
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.[0]?.endsWith('run-chil')).toBe(true);
		expect(blocks[1]?.[0]?.endsWith('run-coor')).toBe(true);
	});

	test('a ship result that lands mid-settle earns exactly one more frame, showing the row filled', async () => {
		const watch = setupWatch({
			onFrame: (frame) => {
				if (frame === 1) {
					watch.shipResult({ branch: 'lo-52-status', status: ShipStatus.Shipped });
				}
			},
		});

		watch.write({
			manifest: manifestOf({
				runId: 'run-shipping',
				status: RunStatus.Passed,
				willShip: true,
				branch: 'lo-52-status',
				steps: [stepOf({ status: RunStatus.Passed })],
			}),
		});

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-shipping', ...timings });

		const blocks = framesOf({ lines: watch.lines });

		// shipping happens after the pipeline returns, so the run's own last frame
		// cannot be the whole story
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.some((line) => line.startsWith(' ·  ship'))).toBe(true);
		expect(blocks[1]?.some((line) => line.includes('ship') && line.includes('passed'))).toBe(true);
	});

	test('a ship result that never lands still earns exactly one more frame once the ceiling passes', async () => {
		const watch = setupWatch();

		watch.write({
			manifest: manifestOf({
				runId: 'run-waiting',
				status: RunStatus.Passed,
				willShip: true,
				branch: 'lo-52-status',
				steps: [stepOf({ status: RunStatus.Passed })],
			}),
		});

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-waiting', ...timings });

		// one quiet wait and one final frame, never fifteen near-identical blocks
		expect(watch.frameCount()).toBe(2);
	});

	test('a run that will not ship gets no settle and no extra frame', async () => {
		const watch = setupWatch();

		watch.write({ manifest: manifestOf({ runId: 'run-plain', status: RunStatus.Passed, steps: [stepOf({ status: RunStatus.Passed })] }) });

		await watchRunProgress({ cwd: watch.cwd, runId: 'run-plain', ...timings });

		expect(watch.frameCount()).toBe(1);
	});

	test('follow mode in a repo where nothing is going paints nothing at all', async () => {
		const watch = setupWatch();

		watch.write({ manifest: manifestOf({ runId: 'run-done', status: RunStatus.Passed }) });

		await watchRunProgress({ cwd: watch.cwd, ...timings });

		expect(watch.frameCount()).toBe(0);
	});
});
