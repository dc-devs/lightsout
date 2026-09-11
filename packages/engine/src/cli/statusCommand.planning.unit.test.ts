import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { type PlanningProgress, PlanningStep, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

// Mocked Imports
// -------------------------
// The two helpers that own a clock: `resolveWatchTarget` waits a minute for a
// run to appear and `watchRunProgress` repaints every two minutes. `--planning`
// reaches for neither; mocking them keeps a regression that falls through to
// the watch path from spending that minute, and lets the cases say it was never
// reached. Everything else — the plan folder, the record, the rendering — is real.
type WatchTarget = { runId: string; rootRunId: string } | { ambiguous: string[] } | undefined;

const mockResolveWatchTarget = jest.fn<(params: { cwd: string; rootRunId?: string }) => Promise<WatchTarget>>();
const mockWatchRunProgress = jest.fn<(params: { cwd: string; runId?: string; rootRunId?: string }) => Promise<void>>();

jest.mock('#src/cli/common/utils/resolveWatchTarget.ts', () => ({
	resolveWatchTarget: (params: { cwd: string; rootRunId?: string }) => mockResolveWatchTarget(params),
}));
jest.mock('#src/cli/common/utils/watchRunProgress.ts', () => ({
	watchRunProgress: (params: { cwd: string; runId?: string; rootRunId?: string }) => mockWatchRunProgress(params),
}));
// -------------------------

/**
 * A demo plan's record with every entry finished: verify-facts passed on its
 * second try, then draft failed. No entry is running, so the block holds no
 * clock that moves between two renders of it.
 */
const finishedRecord: PlanningProgress = {
	name: 'demo',
	updatedAt: '2026-09-10T09:02:00.000Z',
	steps: [
		{
			step: PlanningStep.VerifyFacts,
			status: RunStatus.Passed,
			attempts: 2,
			pid: process.pid,
			startedAt: '2026-09-10T09:00:00.000Z',
			finishedAt: '2026-09-10T09:00:30.000Z',
			durationMs: 30_000,
		},
		{
			step: PlanningStep.Draft,
			status: RunStatus.Failed,
			attempts: 1,
			pid: process.pid,
			startedAt: '2026-09-10T09:01:00.000Z',
			finishedAt: '2026-09-10T09:02:00.000Z',
			durationMs: 60_000,
		},
	],
};

/**
 * A real checkout with an empty runs folder and, unless told otherwise, a demo
 * plan folder — holding the given record when there is one. `expected` is what
 * the planning loader answers for that checkout, taken before any output is
 * captured.
 */
const setupPlanning = async ({ args = { planning: 'demo' }, record }: { args?: Record<string, string | true>; record?: PlanningProgress } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-status-planning-'));
	const planDir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(join(cwd, '.lightsout', 'runs'), { recursive: true });
	mkdirSync(planDir, { recursive: true });
	mockResolveWatchTarget.mockResolvedValue(undefined);
	mockWatchRunProgress.mockResolvedValue(undefined);

	if (record) {
		writeFileSync(join(planDir, 'planning-progress.json'), `${JSON.stringify(record, null, '\t')}\n`, 'utf8');
	}

	const expected = await loadPlanningProgressBlock({ cwd, name: 'demo' });
	const captured = captureCommandOutput();

	return { context: { flags: new Map<string, string | true>(Object.entries(args)), rest: [], cwd }, expected, ...captured };
};

/** The record's checkout is the command's cwd, while the process itself stands in an empty folder of its own. */
const setupPointedCheckout = async () => {
	const processDir = mkdtempSync(join(tmpdir(), 'lightsout-status-process-'));

	jest.spyOn(process, 'cwd').mockReturnValue(processDir);

	return setupPlanning({ record: finishedRecord });
};

describe('statusCommand --planning', () => {
	test('--planning prints a blank line, then exactly the planning block for that plan, and exits 0', async () => {
		const { context, expected, logged, errors, exitCodes } = await setupPlanning({ record: finishedRecord });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['', ...expected]);
		// the block is the record's, not an empty answer both sides happen to share
		expect(logged[1]).toMatch(/^demo +planning$/);
		// nothing runs, so the wall time ends at draft's finish: 09:00:00 to 09:02:00
		expect(logged).toContain(' elapsed 2m 00s · 1 of 5 passed');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--planning on a plan with no record is a normal answer and exits 0', async () => {
		const { context, logged, errors, exitCodes } = await setupPlanning();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe('');
		expect(logged.filter((line) => /^ · {2}\S+ +—$/.test(line))).toStrictEqual([
			expect.stringMatching(/^ · {2}verify-facts /),
			expect.stringMatching(/^ · {2}draft /),
			expect.stringMatching(/^ · {2}dedup /),
			expect.stringMatching(/^ · {2}grade /),
			expect.stringMatching(/^ · {2}publish /),
		]);
		expect(logged).toContain(' elapsed 0m 00s · 0 of 5 passed');
		expect(logged.at(-1)).toMatch(/^ now {2}.*no step has run yet/);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--planning beside --run or --watch prints the usage text on stderr and exits 1', async () => {
		const combinations: Record<string, string | true>[] = [
			{ planning: 'demo', run: 'run-alpha' },
			{ planning: 'demo', watch: true },
		];

		for (const args of combinations) {
			// each setup re-points the console and exit spies at fresh arrays
			const { context, logged, errors, exitCodes } = await setupPlanning({ args, record: finishedRecord });

			await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

			expect(logged).toStrictEqual([]);
			expect(errors).toStrictEqual([usageFixture]);
			expect(exitCodes).toStrictEqual([1]);
		}

		expect(mockResolveWatchTarget).not.toHaveBeenCalled();
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});

	test('--planning with no plan name prints the usage text on stderr and exits 1', async () => {
		const { context, logged, errors, exitCodes } = await setupPlanning({ args: { planning: true }, record: finishedRecord });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		// the run listing would say `no runs found` here and exit 0
		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([usageFixture]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('--planning reads the plan folder under the checkout it is pointed at', async () => {
		const { context, expected, logged, exitCodes } = await setupPointedCheckout();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['', ...expected]);
		// the checkout's verify-facts entry, which an empty process folder could not have drawn
		expect(logged.some((line) => /^ ✓ {2}verify-facts +passed \(x2\) +0m 30s$/.test(line))).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});
});
