import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadShippingProgressBlock } from '#src/cli/common/progressBlock/loadShippingProgressBlock.ts';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { RunStatus, type ShippingProgress, ShippingStepId } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

// Mocked Imports
// -------------------------
// The two helpers that own a clock: `resolveWatchTarget` waits a minute for a
// run to appear and `watchRunProgress` repaints every two minutes. `--shipping`
// reaches for neither; mocking them keeps a regression that falls through to
// the watch path from spending that minute. Everything else — the checkout, the
// record, the rendering — is real.
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
 * A finished ship of `lo-7-ship`: its first attempt ran integrate, push and
 * pull-request, then checks failed. The record is ended, so no row holds a
 * clock that moves between two renders of it, whatever became of its process.
 */
const endedRecord: ShippingProgress = {
	branch: 'lo-7-ship',
	attempt: 1,
	maxAttempts: 3,
	pid: process.pid,
	startedAt: '2026-09-10T09:00:00.000Z',
	updatedAt: '2026-09-10T09:03:00.000Z',
	endedAt: '2026-09-10T09:03:00.000Z',
	lastProgress: 'ship: checks failed on the pull request',
	steps: [
		{ id: ShippingStepId.Integrate, status: RunStatus.Passed, startedAt: '2026-09-10T09:00:00.000Z', durationMs: 30_000 },
		{ id: ShippingStepId.Push, status: RunStatus.Passed, startedAt: '2026-09-10T09:00:30.000Z', durationMs: 10_000 },
		{ id: ShippingStepId.PullRequest, status: RunStatus.Passed, startedAt: '2026-09-10T09:00:40.000Z', durationMs: 20_000 },
		{ id: ShippingStepId.Checks, status: RunStatus.Failed, startedAt: '2026-09-10T09:01:00.000Z', durationMs: 120_000 },
		{ id: ShippingStepId.Merge, status: RunStatus.Pending },
		{ id: ShippingStepId.Sync, status: RunStatus.Pending },
	],
};

/** Beyond any OS pid range — `process.kill(pid, 0)` reports ESRCH, so the recording process reads as gone. */
const deadPid = 999_999_999;

/** Every ship step id, so a line can be checked for naming none of them. */
const stepIds = ['integrate', 'push', 'pull-request', 'checks', 'merge', 'sync'];

/** Local 24-hour HH:MM, worked out here rather than borrowed, so the test states the clock the block must show. */
const localClock = ({ iso }: { iso: string }) => {
	const at = new Date(iso);

	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/** When the ship that stopped between steps last touched its record — 40 seconds after it began. */
const stoppedUpdatedAt = '2026-09-10T09:00:40.000Z';

/**
 * A ship of `lo-7-ship` whose process went away between two steps: push had
 * passed and nothing had started since. No end was stamped.
 */
const stoppedBetweenSteps: ShippingProgress = {
	branch: 'lo-7-ship',
	attempt: 1,
	maxAttempts: 3,
	pid: deadPid,
	startedAt: '2026-09-10T09:00:00.000Z',
	updatedAt: stoppedUpdatedAt,
	lastProgress: 'ship: pushed lo-7-ship',
	steps: [
		{ id: ShippingStepId.Integrate, status: RunStatus.Passed, startedAt: '2026-09-10T09:00:00.000Z', durationMs: 30_000 },
		{ id: ShippingStepId.Push, status: RunStatus.Passed, startedAt: '2026-09-10T09:00:30.000Z', durationMs: 10_000 },
		{ id: ShippingStepId.PullRequest, status: RunStatus.Pending },
		{ id: ShippingStepId.Checks, status: RunStatus.Pending },
		{ id: ShippingStepId.Merge, status: RunStatus.Pending },
		{ id: ShippingStepId.Sync, status: RunStatus.Pending },
	],
};

/** A live ship of `lo-7-ship` under the test's own process, whose pull-request step is running with no start time recorded. */
const runningWithoutStart: ShippingProgress = {
	branch: 'lo-7-ship',
	attempt: 1,
	maxAttempts: 3,
	pid: process.pid,
	startedAt: '2026-09-10T09:00:00.000Z',
	updatedAt: '2026-09-10T09:00:40.000Z',
	lastProgress: 'ship: opening the pull request',
	steps: [
		{ id: ShippingStepId.Integrate, status: RunStatus.Passed, startedAt: '2026-09-10T09:00:00.000Z', durationMs: 30_000 },
		{ id: ShippingStepId.Push, status: RunStatus.Passed, startedAt: '2026-09-10T09:00:30.000Z', durationMs: 10_000 },
		{ id: ShippingStepId.PullRequest, status: RunStatus.Running },
		{ id: ShippingStepId.Checks, status: RunStatus.Pending },
		{ id: ShippingStepId.Merge, status: RunStatus.Pending },
		{ id: ShippingStepId.Sync, status: RunStatus.Pending },
	],
};

/**
 * A real checkout with an empty runs folder and, when one is given, the
 * `lo-7-ship` shipping record in its ship progress folder. `expected` is what
 * the shipping loader answers for that checkout, taken before any output is
 * captured.
 */
const setupShipping = async ({ args = { shipping: 'lo-7-ship' }, record }: { args?: Record<string, string | true>; record?: ShippingProgress } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-status-shipping-'));
	const progressDir = join(cwd, '.lightsout', 'ship', 'progress');

	mkdirSync(join(cwd, '.lightsout', 'runs'), { recursive: true });
	mockResolveWatchTarget.mockResolvedValue(undefined);
	mockWatchRunProgress.mockResolvedValue(undefined);

	if (record) {
		mkdirSync(progressDir, { recursive: true });
		writeFileSync(join(progressDir, 'lo-7-ship.json'), `${JSON.stringify(record, null, '\t')}\n`, 'utf8');
	}

	const expected = await loadShippingProgressBlock({ cwd, branch: 'lo-7-ship' });
	const captured = captureCommandOutput();

	return { context: { flags: new Map<string, string | true>(Object.entries(args)), rest: [], cwd }, expected, ...captured };
};

/**
 * One checkout holding a record, and one command context per flag combination
 * the status command must refuse. They share the checkout and the captured
 * output, so every refusal lands in the same arrays.
 */
const setupRefusals = async () => {
	const combinations: Record<string, string | true>[] = [
		{ shipping: true },
		{ shipping: 'lo-7-ship', run: 'abc' },
		{ shipping: 'lo-7-ship', watch: true },
		{ shipping: 'lo-7-ship', planning: 'demo' },
	];
	const { context, logged, errors, exitCodes } = await setupShipping({ record: endedRecord });
	const contexts = combinations.map((args) => ({ ...context, flags: new Map<string, string | true>(Object.entries(args)) }));

	return { contexts, logged, errors, exitCodes };
};

describe('statusCommand --shipping', () => {
	test('status --shipping prints a blank line and then the shipping block for that branch, and exits 0', async () => {
		const { context, expected, logged, errors, exitCodes } = await setupShipping({ record: endedRecord });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['', ...expected]);
		// the block is the record's, not an empty answer both sides happen to share
		expect(logged[1]).toMatch(/^lo-7-ship /);
		expect(logged.some((line) => /^ ✓ {2}integrate +passed +0m 30s$/.test(line))).toBe(true);
		expect(logged.some((line) => /^ ✗ {2}checks +failed +2m 00s$/.test(line))).toBe(true);
		expect(logged.at(-1)).toBe(' now  ship: checks failed on the pull request');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('status --shipping for a branch with no record is a normal answer and exits 0', async () => {
		const { context, expected, logged, errors, exitCodes } = await setupShipping();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['', ...expected]);
		expect(logged[1]).toMatch(/^lo-7-ship /);
		expect(logged.filter((line) => /^ · {2}\S+ +—$/.test(line))).toEqual([
			expect.stringMatching(/^ · {2}integrate /),
			expect.stringMatching(/^ · {2}push /),
			expect.stringMatching(/^ · {2}pull-request /),
			expect.stringMatching(/^ · {2}checks /),
			expect.stringMatching(/^ · {2}merge /),
			expect.stringMatching(/^ · {2}sync /),
		]);
		expect(logged.at(-1)).toMatch(/^ now {2}.*no step has run yet/);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('status --shipping for a ship whose process stopped between steps says no live process is recording it, naming no step', async () => {
		const { context, logged, errors, exitCodes } = await setupShipping({ record: stoppedBetweenSteps });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		const diagnostics = logged.filter((line) => /no live process/i.test(line));

		expect(diagnostics).toEqual([expect.stringContaining(localClock({ iso: stoppedUpdatedAt }))]);
		expect(stepIds.filter((id) => diagnostics[0]?.includes(id))).toStrictEqual([]);
		expect(logged.some((line) => /running|▶/.test(line))).toBe(false);
		expect(logged.at(-2)).toMatch(/0m 40s$/);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('status --shipping draws a live running step with no recorded start as running, with no clock', async () => {
		const { context, logged, exitCodes } = await setupShipping({ record: runningWithoutStart });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.filter((line) => line.includes('pull-request'))).toEqual([expect.stringMatching(/^ ▶ {2}pull-request +running +—$/)]);
		expect(logged.some((line) => /no live process/i.test(line))).toBe(false);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('status --shipping draws a last progress line that spans several lines as one now line', async () => {
		const { context, logged } = await setupShipping({ record: { ...endedRecord, lastProgress: 'ship: checks failed\n  on #41\tafter 2m\n' } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.at(-1)).toBe(' now  ship: checks failed on #41 after 2m');
	});

	test.each([
		{ narrated: 'nothing', lastProgress: undefined },
		{ narrated: 'only whitespace', lastProgress: ' \n\t ' },
	])('status --shipping draws no now line for a ship that narrated $narrated', async ({ lastProgress }) => {
		const { context, logged } = await setupShipping({ record: { ...endedRecord, lastProgress } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.some((line) => line.startsWith(' now'))).toBe(false);
		expect(logged.at(-1)).toMatch(/3m 00s$/);
	});

	test('status --shipping without a branch, or beside --run, --watch or --planning, prints the usage text to stderr and exits 1', async () => {
		const { contexts, logged, errors, exitCodes } = await setupRefusals();

		const commands = contexts.map((context) => statusCommand(context));
		const outcomes = await Promise.allSettled(commands);

		expect(outcomes).toEqual([
			{ status: 'rejected', reason: expect.objectContaining({ message: 'process.exit' }) },
			{ status: 'rejected', reason: expect.objectContaining({ message: 'process.exit' }) },
			{ status: 'rejected', reason: expect.objectContaining({ message: 'process.exit' }) },
			{ status: 'rejected', reason: expect.objectContaining({ message: 'process.exit' }) },
		]);
		// the run listing, the planning block or a watch frame would each have logged here
		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([usageFixture, usageFixture, usageFixture, usageFixture]);
		expect(exitCodes).toStrictEqual([1, 1, 1, 1]);
		expect(mockResolveWatchTarget).not.toHaveBeenCalled();
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});
});
