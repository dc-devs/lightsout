import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadShippingProgressBlock } from '#src/cli/common/progressBlock/loadShippingProgressBlock.ts';
import { RunStatus, type ShippingProgress, ShippingStepId } from '#src/contracts/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/** One step row as the record holds it. */
type ShippingStepRecord = ShippingProgress['steps'][number];

/** The branch every case reads. */
const branch = 'lo-7-ship';

/** When every block in this file is drawn, so each clock it shows is known. */
const systemTime = '2026-09-10T10:12:30.000Z';

/** Beyond any OS pid range — `process.kill(pid, 0)` reports ESRCH, so the recording process reads as gone. */
const deadPid = 999_999_999;

/** When the ship in every stored record began — 7m 30s before the system time. */
const shipStartedAt = '2026-09-10T10:05:00.000Z';

/** A step the block has not reached: the glyph, the id column, and the em dash — no outcome and no clock. */
const notReached = {
	integrate: ' ·  integrate            —',
	push: ' ·  push                 —',
	pullRequest: ' ·  pull-request         —',
	checks: ' ·  checks               —',
	merge: ' ·  merge                —',
	sync: ' ·  sync                 —',
};

/** Local 24-hour HH:MM, worked out here rather than borrowed, so the test states the clock the block must show. */
const localClock = ({ iso }: { iso: string }) => {
	const at = new Date(iso);

	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/** The seconds a row's trailing `<m>m <ss>s` clock shows, or undefined when it shows none. */
const clockSeconds = ({ line }: { line: string }) => {
	const match = /(\d+)m (\d{2})s$/.exec(line);

	return match === null ? undefined : Number(match[1]) * 60 + Number(match[2]);
};

const passedStep = ({ id, startedAt, durationMs }: { id: ShippingStepId; startedAt: string; durationMs: number }): ShippingStepRecord => ({
	id,
	status: RunStatus.Passed,
	startedAt,
	durationMs,
});

const pendingStep = ({ id }: { id: ShippingStepId }): ShippingStepRecord => ({ id, status: RunStatus.Pending });

/** The record as the recorder writes it: tab-indented JSON with a trailing newline. */
const recordOf = (progress: ShippingProgress) => `${JSON.stringify(progress, null, '\t')}\n`;

/** The last progress line the live ship narrated. */
const liveLastProgress = 'opening the pull request for lo-7-ship';

/** Attempt 2 of 3 under the test's own process: integrate and push passed, pull-request running since 90 seconds before the system time. */
const liveRecord = () =>
	recordOf({
		branch,
		attempt: 2,
		maxAttempts: 3,
		pid: process.pid,
		startedAt: shipStartedAt,
		updatedAt: '2026-09-10T10:11:00.000Z',
		lastProgress: liveLastProgress,
		steps: [
			passedStep({ id: ShippingStepId.Integrate, startedAt: '2026-09-10T10:10:00.000Z', durationMs: 40_000 }),
			passedStep({ id: ShippingStepId.Push, startedAt: '2026-09-10T10:10:40.000Z', durationMs: 20_000 }),
			{ id: ShippingStepId.PullRequest, status: RunStatus.Running, startedAt: '2026-09-10T10:11:00.000Z' },
			pendingStep({ id: ShippingStepId.Checks }),
			pendingStep({ id: ShippingStepId.Merge }),
			pendingStep({ id: ShippingStepId.Sync }),
		],
	});

/** When the stale record was last touched — 4m 20s after the ship began, and a different minute from every other time it holds. */
const staleUpdatedAt = '2026-09-10T10:09:20.000Z';

/** Checks were running when the recording process went away, with no end stamped. */
const staleRecord = () =>
	recordOf({
		branch,
		attempt: 1,
		maxAttempts: 3,
		pid: deadPid,
		startedAt: shipStartedAt,
		updatedAt: staleUpdatedAt,
		lastProgress: 'waiting for checks on #41',
		steps: [
			passedStep({ id: ShippingStepId.Integrate, startedAt: shipStartedAt, durationMs: 60_000 }),
			passedStep({ id: ShippingStepId.Push, startedAt: '2026-09-10T10:06:00.000Z', durationMs: 20_000 }),
			passedStep({ id: ShippingStepId.PullRequest, startedAt: '2026-09-10T10:06:20.000Z', durationMs: 10_000 }),
			{ id: ShippingStepId.Checks, status: RunStatus.Running, startedAt: '2026-09-10T10:06:30.000Z' },
			pendingStep({ id: ShippingStepId.Merge }),
			pendingStep({ id: ShippingStepId.Sync }),
		],
	});

/** When the finished ship stamped its end — 6m 10s after it began. */
const finishedEndedAt = '2026-09-10T10:11:10.000Z';

/**
 * The ship ended with merge refused, and the process that recorded it has since
 * exited. Its step durations sum to 5m 30s, so a total that adds them up rather
 * than measuring start to end reads differently.
 */
const finishedRecord = () =>
	recordOf({
		branch,
		attempt: 1,
		maxAttempts: 3,
		pid: deadPid,
		startedAt: shipStartedAt,
		updatedAt: finishedEndedAt,
		endedAt: finishedEndedAt,
		lastProgress: 'merge refused for lo-7-ship',
		steps: [
			passedStep({ id: ShippingStepId.Integrate, startedAt: shipStartedAt, durationMs: 60_000 }),
			passedStep({ id: ShippingStepId.Push, startedAt: '2026-09-10T10:06:00.000Z', durationMs: 20_000 }),
			passedStep({ id: ShippingStepId.PullRequest, startedAt: '2026-09-10T10:06:20.000Z', durationMs: 10_000 }),
			passedStep({ id: ShippingStepId.Checks, startedAt: '2026-09-10T10:06:30.000Z', durationMs: 200_000 }),
			{ id: ShippingStepId.Merge, status: RunStatus.Failed, startedAt: '2026-09-10T10:10:30.000Z', durationMs: 40_000 },
			pendingStep({ id: ShippingStepId.Sync }),
		],
	});

/**
 * A fresh checkout with only the clock faked, so every clock the block draws is
 * known while the file reads stay real. `record` is written verbatim as the
 * branch's shipping record when given; otherwise the progress folder is empty.
 */
const setupShippingBlock = async ({ record }: { record?: string } = {}) => {
	jest.useFakeTimers({
		now: new Date(systemTime),
		doNotFake: [
			'hrtime',
			'nextTick',
			'performance',
			'queueMicrotask',
			'requestAnimationFrame',
			'cancelAnimationFrame',
			'requestIdleCallback',
			'cancelIdleCallback',
			'setImmediate',
			'clearImmediate',
			'setInterval',
			'clearInterval',
			'setTimeout',
			'clearTimeout',
			'Temporal',
		],
	});

	const cwd = await freshCwd();
	const progressDir = join(cwd, '.lightsout', 'ship', 'progress');
	const recordPath = join(progressDir, 'lo-7-ship.json');

	mkdirSync(progressDir, { recursive: true });

	if (record !== undefined) {
		writeFileSync(recordPath, record);
	}

	return { cwd, recordPath };
};

describe('loadShippingProgressBlock', () => {
	test('a branch with no record draws all six steps not reached and says no step has run yet', async () => {
		const { cwd } = await setupShippingBlock();

		const lines = await loadShippingProgressBlock({ cwd, branch });

		expect(lines[0]).toMatch(/^lo-7-ship +\S/);
		expect(lines).toHaveLength(11);
		expect(lines.slice(2, 8)).toStrictEqual([
			notReached.integrate,
			notReached.push,
			notReached.pullRequest,
			notReached.checks,
			notReached.merge,
			notReached.sync,
		]);
		expect(lines.at(-2)).toMatch(/^ .*0m 00s/);
		expect(lines.at(-1)).toMatch(/^ now {2}.*no step has run yet/i);
		expect(lines.some((line) => line.includes('▶'))).toBe(false);
	});

	test('an unreadable record is one line naming the file', async () => {
		const { cwd, recordPath } = await setupShippingBlock({ record: '{ this is not json\n' });

		const lines = await loadShippingProgressBlock({ cwd, branch });

		expect(lines).toEqual([expect.stringContaining(recordPath)]);
	});

	test('a live record draws its running step as running, the attempt in the title, and its last progress line as now', async () => {
		const { cwd } = await setupShippingBlock({ record: liveRecord() });

		const lines = await loadShippingProgressBlock({ cwd, branch });

		const pullRequestRow = lines[4] ?? '';

		expect(lines[0]).toMatch(/^lo-7-ship +\D*2\D+3\D*$/);
		expect(lines.slice(2, 4)).toEqual([expect.stringMatching(/^ ✓ {2}integrate +passed +0m 40s$/), expect.stringMatching(/^ ✓ {2}push +passed +0m 20s$/)]);
		expect(pullRequestRow).toMatch(/^ ▶ {2}pull-request +running +\d+m \d{2}s$/);
		expect(clockSeconds({ line: pullRequestRow })).toBeGreaterThanOrEqual(90);
		expect(lines.at(-1)).toMatch(/^ now {2}/);
		expect(lines.at(-1)).toContain(liveLastProgress);
	});

	test('a running step whose process is gone is not drawn as running, and the block gives the last update time', async () => {
		const { cwd } = await setupShippingBlock({ record: staleRecord() });

		const lines = await loadShippingProgressBlock({ cwd, branch });

		const rowLines = lines.slice(2, 8);
		const checksRow = rowLines[3] ?? '';
		const diagnosticLine = lines[8] ?? '';

		expect(rowLines.some((line) => line.includes('▶') || /running/i.test(line))).toBe(false);
		expect(checksRow).toMatch(/^ ✗ {2}checks +failed\b/);
		expect(checksRow).not.toMatch(/\d+m \d{2}s/);
		expect(diagnosticLine).toContain('checks');
		expect(diagnosticLine).toMatch(/no live process/i);
		expect(diagnosticLine).toContain(localClock({ iso: staleUpdatedAt }));
		expect(lines.at(-2)).toContain('4m 20s');
		expect(lines.at(-2)).not.toContain('7m 30s');
	});

	test('a finished record reads as finished whatever became of its process', async () => {
		const { cwd } = await setupShippingBlock({ record: finishedRecord() });

		const lines = await loadShippingProgressBlock({ cwd, branch });

		expect(lines.some((line) => /no live process/i.test(line))).toBe(false);
		expect(lines[6]).toMatch(/^ ✗ {2}merge +failed +0m 40s$/);
		expect(lines.at(-2)).toContain('6m 10s');
		expect(lines.at(-2)).not.toContain('7m 30s');
	});
});
