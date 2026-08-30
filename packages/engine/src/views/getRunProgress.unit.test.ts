import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type RunLock, type RunManifest, RunStatus, ShipStatus, type StepRecord } from '#src/contracts/index.ts';
import { getRunProgress } from '#src/views/index.ts';

const runId = 'run-progress-01';

/** Beyond any OS pid range — the live-process probe reports it dead. */
const deadPid = 999_999_999;

const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:10:00.000Z',
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status: RunStatus.Running,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	...overrides,
});

const stepOf = (overrides: Partial<StepRecord> = {}): StepRecord => ({
	id: 'implement',
	status: RunStatus.Passed,
	attempts: 1,
	durationMs: 1_000,
	...overrides,
});

/**
 * A real repo holding the run's own evidence — its progress log and, when the
 * case wants one, a filed ship result. The manifest is passed in rather than
 * read back, exactly as `statusCommand` passes the one it already read.
 */
const setupProgress = ({
	manifest = manifestOf(),
	lock,
	narrated = [],
	shipResult,
}: {
	manifest?: RunManifest;
	lock?: RunLock;
	narrated?: string[];
	shipResult?: { branch: string; status: ShipStatus };
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-progress-'));

	mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });

	if (narrated.length > 0) {
		writeFileSync(
			join(cwd, '.lightsout', 'runs', manifest.runId, 'progress.jsonl'),
			narrated.map((message) => `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', message })}\n`).join(''),
			'utf8',
		);
	}

	if (shipResult) {
		mkdirSync(join(cwd, '.lightsout', 'ship'), { recursive: true });
		writeFileSync(
			join(cwd, '.lightsout', 'ship', `${shipResult.branch}.json`),
			JSON.stringify({ status: shipResult.status, branch: shipResult.branch, failingChecks: [] }),
			'utf8',
		);
	}

	return { cwd, manifest, lock };
};

/** The run's rows as [id, status, attempts] triples — the whole table, minus the clock. */
const shapeOf = ({ rows }: { rows: { id: string; status: RunStatus | undefined; attempts: number }[] }) =>
	rows.map((row) => [row.id, row.status, row.attempts]);

describe('getRunProgress', () => {
	test('every recorded step becomes a row, in the order the manifest records them', async () => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({ steps: [stepOf({ id: 'clean-slate' }), stepOf({ id: 'implement', attempts: 2 })] }),
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(shapeOf({ rows: progress.rows })).toStrictEqual([
			['clean-slate', RunStatus.Passed, 1],
			['implement', RunStatus.Passed, 2],
		]);
	});

	test('a declared step the run has not reached becomes a pending row, and a recorded one is never duplicated', async () => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({ steps: [stepOf({ id: 'clean-slate' })], stepOrder: ['clean-slate', 'implement', 'format'] }),
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(shapeOf({ rows: progress.rows })).toStrictEqual([
			['clean-slate', RunStatus.Passed, 1],
			['implement', undefined, 0],
			['format', undefined, 0],
		]);
		expect(progress.rows.map((row) => row.durationMs)).toStrictEqual([1_000, undefined, undefined]);
	});

	test('a run whose pipeline declared no order gets no pending rows at all — a guessed row is worse than none', async () => {
		const { cwd, manifest } = setupProgress({ manifest: manifestOf({ steps: [stepOf({ id: 'batch-01' })] }) });

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(shapeOf({ rows: progress.rows })).toStrictEqual([['batch-01', RunStatus.Passed, 1]]);
	});

	test('a live run’s running row and its elapsed both carry the time since the manifest was last written', async () => {
		const updatedAt = new Date(Date.now() - 60_000).toISOString();
		const { cwd, manifest, lock } = setupProgress({
			manifest: manifestOf({
				createdAt: new Date(Date.now() - 660_000).toISOString(),
				updatedAt,
				steps: [stepOf({ id: 'refactor', status: RunStatus.Running, durationMs: 5_000 })],
			}),
			lock: { pid: process.pid, runId, startedAt: updatedAt },
		});

		const progress = await getRunProgress({ cwd, manifest, lock });

		expect(progress.live).toBe(true);
		// a forty-minute step frozen at its last write tells a reader nothing
		expect(progress.rows[0]?.durationMs ?? 0).toBeGreaterThanOrEqual(64_000);
		expect(progress.elapsedMs).toBeGreaterThanOrEqual(659_000);
	});

	test('a running step that has not been timed yet still ticks from zero rather than reading as no duration at all', async () => {
		const updatedAt = new Date(Date.now() - 30_000).toISOString();
		const { cwd, manifest, lock } = setupProgress({
			manifest: manifestOf({ updatedAt, steps: [stepOf({ id: 'clean-slate', status: RunStatus.Running, durationMs: undefined })] }),
			lock: { pid: process.pid, runId, startedAt: updatedAt },
		});

		expect((await getRunProgress({ cwd, manifest, lock })).rows[0]?.durationMs ?? 0).toBeGreaterThanOrEqual(29_000);
	});

	test('a run with no process behind it shows the persisted duration unchanged — a zombie must not read as work', async () => {
		const { cwd, manifest, lock } = setupProgress({
			manifest: manifestOf({ steps: [stepOf({ id: 'refactor', status: RunStatus.Running, durationMs: 5_000 })] }),
			lock: { pid: deadPid, runId, startedAt: '2026-01-01T00:00:00.000Z' },
		});

		const progress = await getRunProgress({ cwd, manifest, lock });

		expect(progress.live).toBe(false);
		expect(progress.rows[0]?.durationMs).toBe(5_000);
		expect(progress.elapsedMs).toBe(600_000);
	});

	test('a manifest stamped ahead of this clock adds nothing rather than running a live step backwards', async () => {
		const { cwd, manifest, lock } = setupProgress({
			manifest: manifestOf({
				createdAt: new Date(Date.now() - 600_000).toISOString(),
				updatedAt: new Date(Date.now() + 120_000).toISOString(),
				steps: [stepOf({ id: 'refactor', status: RunStatus.Running, durationMs: 5_000 })],
			}),
			lock: { pid: process.pid, runId, startedAt: '2026-01-01T00:00:00.000Z' },
		});

		const progress = await getRunProgress({ cwd, manifest, lock });

		expect(progress.live).toBe(true);
		// a skewed clock must not subtract time from a step that has already run
		expect(progress.rows[0]?.durationMs).toBe(5_000);
	});

	test('a manifest whose last write precedes its own creation reads as no elapsed time, never a negative one', async () => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({ createdAt: '2026-01-01T00:10:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', steps: [stepOf()] }),
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(progress.elapsedMs).toBe(0);
	});

	test('a run nobody asked to ship gets no ship row and is never awaiting one', async () => {
		const { cwd, manifest } = setupProgress({ manifest: manifestOf({ status: RunStatus.Passed, steps: [stepOf()] }) });

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(progress.rows.map((row) => row.id)).toStrictEqual(['implement']);
		expect(progress.awaitingShip).toBe(false);
	});

	test('a run that will ship shows ship as its last row, pending until a result is filed', async () => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({ status: RunStatus.Passed, willShip: true, branch: 'lo-52-status', steps: [stepOf()] }),
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(shapeOf({ rows: progress.rows })).toStrictEqual([
			['implement', RunStatus.Passed, 1],
			['ship', undefined, 0],
		]);
		// the ship happens after the pipeline returns, so a terminal run can still
		// have a story left to tell
		expect(progress.awaitingShip).toBe(true);
	});

	test.each([
		{ label: 'a shipped branch', status: ShipStatus.Shipped, expected: RunStatus.Passed },
		{ label: 'a blocked one', status: ShipStatus.Blocked, expected: RunStatus.Failed },
	])('the ship row reads $label from the branch’s own result', async ({ status, expected }) => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({ status: RunStatus.Passed, willShip: true, branch: 'lo-52-status', steps: [stepOf()] }),
			shipResult: { branch: 'lo-52-status', status },
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(progress.rows.at(-1)).toStrictEqual({ id: 'ship', status: expected, attempts: 1, durationMs: undefined });
		expect(progress.awaitingShip).toBe(false);
	});

	test('a run that recorded no branch cannot find its own result, so the ship row stays pending', async () => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({ status: RunStatus.Passed, willShip: true, steps: [stepOf()] }),
			shipResult: { branch: 'lo-52-status', status: ShipStatus.Shipped },
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(progress.rows.at(-1)).toStrictEqual({ id: 'ship', status: undefined, attempts: 0, durationMs: undefined });
	});

	test.each([
		{ label: 'failed', status: RunStatus.Failed },
		{ label: 'escalated', status: RunStatus.Escalated },
	])('a run that ended $label gets no ship row — that ship will never happen', async ({ status }) => {
		const { cwd, manifest } = setupProgress({ manifest: manifestOf({ status, willShip: true, branch: 'lo-52-status', steps: [stepOf()] }) });

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(progress.rows.map((row) => row.id)).toStrictEqual(['implement']);
		expect(progress.awaitingShip).toBe(false);
	});

	test('a paused run keeps its ship row, because a resume can still finish and ship it', async () => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({ status: RunStatus.PausedRateLimit, willShip: true, branch: 'lo-52-status', steps: [stepOf()] }),
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(progress.rows.map((row) => row.id)).toStrictEqual(['implement', 'ship']);
	});

	test('the now line is the last thing the run narrated, and the header comes from the manifest', async () => {
		const { cwd, manifest } = setupProgress({
			manifest: manifestOf({
				changedFiles: ['src/a.ts', 'src/b.ts'],
				usage: { invocations: 2, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 43.54 },
			}),
			narrated: ['step implement', 'step refactor — pass 1/3'],
		});

		const progress = await getRunProgress({ cwd, manifest, lock: undefined });

		expect(progress).toEqual(
			expect.objectContaining({ runId, shortId: 'run-prog', title: 'demo', changedFileCount: 2, costUsd: 43.54, now: 'step refactor — pass 1/3' }),
		);
	});

	test('a run that has narrated nothing has no now line rather than an empty one', async () => {
		const { cwd, manifest } = setupProgress();

		expect((await getRunProgress({ cwd, manifest, lock: undefined })).now).toBeUndefined();
	});
});
