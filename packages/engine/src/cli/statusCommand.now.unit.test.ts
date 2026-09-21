import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadRunProgressBlock } from '#src/cli/common/progressBlock/loadRunProgressBlock.ts';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { type CapturedCommandOutput, captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

// Mocked Imports
// -------------------------
// The two helpers that own a clock: `resolveWatchTarget` can wait a minute for
// a run to appear and `watchRunProgress` repaints every two minutes. The
// one-shot form asks the resolver for no grace at all and must never reach the
// watch; mocking both keeps a regression that falls through to the watch path
// from spending that minute, and lets the cases say it was never reached.
// Everything else — the runs folder, the manifests, the rendering — is real.
type WatchTarget = { runId: string; rootRunId: string } | { ambiguous: string[] } | undefined;
interface WatchTargetParams {
	cwd: string;
	rootRunId?: string;
	graceMs?: number;
	pollMs?: number;
}

const mockResolveWatchTarget = jest.fn<(params: WatchTargetParams) => Promise<WatchTarget>>();
const mockWatchRunProgress = jest.fn<(params: { cwd: string; runId?: string; rootRunId?: string }) => Promise<void>>();

jest.mock('#src/cli/common/utils/resolveWatchTarget.ts', () => ({
	resolveWatchTarget: (params: WatchTargetParams) => mockResolveWatchTarget(params),
}));
jest.mock('#src/cli/common/utils/watchRunProgress.ts', () => ({
	watchRunProgress: (params: { cwd: string; runId?: string; rootRunId?: string }) => mockWatchRunProgress(params),
}));
// -------------------------

/** The phased coordinator, by full id — its first eight characters are what its block's title line ends with. */
const coordinatorRunId = 'c0000001-0000-4000-8000-000000000000';

/** The phase child the coordinator started, moving right now. */
const phaseRunId = 'ph000002-0000-4000-8000-000000000000';

/** A finished run, the most recently updated in a quiet repo. */
const newestRunId = 'n0000003-0000-4000-8000-000000000000';

/** A second finished run, updated before the one above. */
const olderRunId = 'o0000004-0000-4000-8000-000000000000';

/** A run family unrelated to the coordinator's — the second name in the ambiguous answer. */
const unrelatedRunId = 'u0000005-0000-4000-8000-000000000000';

type SeededManifest = Partial<RunManifest> & { runId: string };

/** The coordinator of a phased plan: one step per phase, the second of them moving. */
const coordinatorManifest: SeededManifest = {
	runId: coordinatorRunId,
	pipeline: PipelineKind.Phases,
	plan: 'plans/demo/plan.md',
	status: RunStatus.Running,
	createdAt: '2026-09-10T09:00:00.000Z',
	updatedAt: '2026-09-10T09:05:00.000Z',
	currentStep: 'phase-2',
	steps: [
		{ id: 'phase-1', status: RunStatus.Passed, attempts: 1, durationMs: 120_000 },
		{ id: 'phase-2', status: RunStatus.Running, attempts: 1, durationMs: 60_000 },
	],
};

/** The phase the coordinator is inside: its own steps, and the coordinator named as its parent. */
const phaseManifest: SeededManifest = {
	runId: phaseRunId,
	parentRunId: coordinatorRunId,
	plan: 'plans/demo/phase-2.md',
	status: RunStatus.Running,
	createdAt: '2026-09-10T09:03:00.000Z',
	updatedAt: '2026-09-10T09:06:00.000Z',
	currentStep: 'implement',
	steps: [{ id: 'implement', status: RunStatus.Running, attempts: 1, durationMs: 60_000 }],
	stepOrder: ['implement', 'test'],
};

/** A run that has ended, updated after every other seeded run — the newest of any status. */
const newestManifest: SeededManifest = {
	runId: newestRunId,
	plan: 'plans/newest/plan.md',
	status: RunStatus.Passed,
	createdAt: '2026-09-10T09:10:00.000Z',
	updatedAt: '2026-09-10T09:20:00.000Z',
	steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1, durationMs: 60_000 }],
};

/** A run that ended earlier, so a fallback taking it instead of the one above shows a different block. */
const olderManifest: SeededManifest = {
	runId: olderRunId,
	plan: 'plans/older/plan.md',
	status: RunStatus.Failed,
	createdAt: '2026-09-10T09:01:00.000Z',
	updatedAt: '2026-09-10T09:02:00.000Z',
	steps: [{ id: 'implement', status: RunStatus.Failed, attempts: 2, durationMs: 30_000 }],
};

/** One run's block exactly as `loadRunProgressBlock` draws it — the lines the one-shot form must hand back untouched. */
const blockOf = async ({ cwd, runId }: { cwd: string; runId: string }) => (await loadRunProgressBlock({ cwd, runId })).lines;

/**
 * A fresh checkout holding the given runs, with the run resolver answering the
 * given target. No run carries a lock, so no row ticks and a block drawn twice
 * reads the same both times.
 */
const setupRuns = async ({ seeded = [], target }: { seeded?: SeededManifest[]; target?: WatchTarget } = {}) => {
	const cwd = await freshCwd();

	for (const manifest of seeded) {
		await seedRunDir({ cwd, manifest });
	}

	mockResolveWatchTarget.mockResolvedValue(target);
	mockWatchRunProgress.mockResolvedValue(undefined);

	return { cwd };
};

/** A checkout where the coordinator and its running phase child are both readable, and the resolver names the child. */
const setupGoingFamily = async () => {
	const { cwd } = await setupRuns({ seeded: [coordinatorManifest, phaseManifest], target: { runId: phaseRunId, rootRunId: coordinatorRunId } });
	const coordinator = await blockOf({ cwd, runId: coordinatorRunId });
	const phase = await blockOf({ cwd, runId: phaseRunId });

	return { cwd, expected: ['', ...coordinator, '', ...phase] };
};

/** The same family, with the coordinator's manifest left half-written — its directory still stands, so the child still names it. */
const setupUnreadableCoordinator = async () => {
	const { cwd } = await setupRuns({ seeded: [coordinatorManifest, phaseManifest], target: { runId: phaseRunId, rootRunId: coordinatorRunId } });
	const phase = await blockOf({ cwd, runId: phaseRunId });

	await writeFile(join(runDirFor({ cwd, runId: coordinatorRunId, pipeline: PipelineKind.Phases }), 'manifest.json'), '{ "runId": "c0000', 'utf8');

	return { cwd, expected: ['', ...phase] };
};

/** A quiet checkout: two runs that have ended and nothing going. */
const setupNothingGoing = async () => {
	const { cwd } = await setupRuns({ seeded: [olderManifest, newestManifest] });

	return { cwd, expected: ['', ...(await blockOf({ cwd, runId: newestRunId }))] };
};

/** Two unrelated families going at once — the answer nothing can choose between. */
const setupAmbiguous = () => setupRuns({ target: { ambiguous: [coordinatorRunId, unrelatedRunId] } });

/**
 * Run the command in one checkout with its own captured streams. `process.exit`
 * throws rather than returning, so the captured exit codes are what say the
 * command ended — and anything else thrown is a real failure and rethrown.
 */
const runStatus = async ({ cwd, args }: { cwd: string; args: Record<string, string | true> }) => {
	const captured = captureCommandOutput();

	await statusCommand({ flags: new Map<string, string | true>(Object.entries(args)), rest: [], cwd }).catch((error: unknown) => {
		if (!(error instanceof Error && error.message === 'process.exit')) {
			throw error;
		}
	});

	return captured;
};

describe('statusCommand --now', () => {
	test('--now prints the going run family block once and never starts a watch', async () => {
		const { cwd, expected } = await setupGoingFamily();

		const { logged, errors, exitCodes } = await runStatus({ cwd, args: { now: true } });

		expect(logged).toStrictEqual(expected);
		// both levels: the phase sequence, then the phase moving now — not one of them twice
		expect(logged.some((line) => line.endsWith('c0000001'))).toBe(true);
		expect(logged.some((line) => line.endsWith('ph000002'))).toBe(true);
		// the leading blank line and the one separating the two blocks, and no third: a repaint would append another
		expect(logged.filter((line) => line === '')).toHaveLength(2);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});

	test('--now with nothing going falls back to the newest run and asks its resolver for no grace at all', async () => {
		const { cwd, expected } = await setupNothingGoing();

		const { logged, errors, exitCodes } = await runStatus({ cwd, args: { now: true } });

		expect(logged).toStrictEqual(expected);
		// the newest run's block, not the older one both answers would share a shape with
		expect(logged[1]?.endsWith('n0000003')).toBe(true);
		// zero grace is what makes the answer immediate rather than a minute of waiting
		expect(mockResolveWatchTarget).toHaveBeenCalledWith({ cwd, graceMs: 0 });
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});

	test('--now in a repo with no runs says so and exits 0', async () => {
		const { cwd } = await setupRuns();

		const { logged, errors, exitCodes } = await runStatus({ cwd, args: { now: true } });

		expect(logged).toStrictEqual(['no runs found']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("--now still answers when the going phase's coordinator manifest cannot be read", async () => {
		const { cwd, expected } = await setupUnreadableCoordinator();

		const { logged, errors, exitCodes } = await runStatus({ cwd, args: { now: true } });

		expect(logged).toStrictEqual(expected);
		// the phase the reader can still see, alone — nothing honest is left to pair it with
		expect(logged.some((line) => line.endsWith('ph000002'))).toBe(true);
		expect(logged.some((line) => line.endsWith('c0000001'))).toBe(false);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--now with two unrelated families going names both ids and exits 1', async () => {
		const { cwd } = await setupAmbiguous();

		const { logged, errors, exitCodes } = await runStatus({ cwd, args: { now: true } });

		// no block: narrating somebody else's concurrent work is worse than asking
		expect(logged).toStrictEqual([]);
		expect(errors).toEqual([expect.stringContaining(coordinatorRunId), expect.stringContaining('--run <id>')]);
		expect(errors[0]).toContain(unrelatedRunId);
		expect(exitCodes).toStrictEqual([1]);
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});

	test('--now and a bare --watch describe several going runs in exactly the same words', async () => {
		const { cwd } = await setupAmbiguous();

		// two invocations because the claim IS the comparison: one state, two forms
		const now = await runStatus({ cwd, args: { now: true } });
		const watch = await runStatus({ cwd, args: { watch: true } });

		expect(now.errors).toStrictEqual(watch.errors);
		expect(now.errors).toHaveLength(2);
		expect(now.exitCodes).toStrictEqual(watch.exitCodes);
	});

	test('--now beside another status form, or carrying a value, prints the usage text and exits 1', async () => {
		const refusals: Record<string, string | true>[] = [
			{ now: true, run: newestRunId },
			{ now: true, watch: true },
			{ now: true, planning: 'demo' },
			{ now: true, shipping: 'lo-9-demo' },
			{ now: true, queue: true },
			{ now: 'a-value' },
		];
		const { cwd } = await setupRuns({ seeded: [newestManifest] });

		// each run re-points the console and exit spies at fresh arrays of its own
		const outcomes: CapturedCommandOutput[] = [];

		for (const args of refusals) {
			outcomes.push(await runStatus({ cwd, args }));
		}

		expect(outcomes.map(({ logged }) => logged)).toStrictEqual([[], [], [], [], [], []]);
		expect(outcomes.map(({ errors }) => errors)).toStrictEqual([
			[usageFixture],
			[usageFixture],
			[usageFixture],
			[usageFixture],
			[usageFixture],
			[usageFixture],
		]);
		expect(outcomes.map(({ exitCodes }) => exitCodes)).toStrictEqual([[1], [1], [1], [1], [1], [1]]);
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});

	test('a bare status with no flags still prints the run listing', async () => {
		const { cwd } = await setupRuns({ seeded: [olderManifest, newestManifest] });

		const { logged, errors, exitCodes } = await runStatus({ cwd, args: {} });

		expect(logged).toEqual(expect.arrayContaining([expect.stringContaining(newestRunId), expect.stringContaining(olderRunId)]));
		// one line per recorded run, not a block for the run that is going
		expect(logged).toHaveLength(2);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
		expect(mockResolveWatchTarget).not.toHaveBeenCalled();
	});
});
