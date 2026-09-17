import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { type PlanningProgress, PlanningStep, type PlanningStepRecord, RunStatus } from '#src/contracts/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/** The plan folder every case reads. */
const name = 'demo';

/** When every block in this file is drawn, so each clock it shows is known. */
const systemTime = '2026-09-10T10:12:30.000Z';

/** Beyond any OS pid range — `process.kill(pid, 0)` reports ESRCH, so the recording process reads as gone. */
const deadPid = 999_999_999;

/** A step the block has not reached: the glyph, the id column, and the em dash — no outcome and no clock. */
const notReached = {
	verifyFacts: ' ·  verify-facts         —',
	draft: ' ·  draft                —',
	dedup: ' ·  dedup                —',
	grade: ' ·  grade                —',
	publish: ' ·  publish              —',
};

/** Local 24-hour HH:MM, worked out here rather than borrowed, so the test states the clock the block must show. */
const localClock = ({ iso }: { iso: string }) => {
	const at = new Date(iso);

	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

const entryOf = (overrides: Partial<PlanningStepRecord> & Pick<PlanningStepRecord, 'step' | 'status' | 'startedAt'>): PlanningStepRecord => ({
	attempts: 1,
	pid: process.pid,
	...overrides,
});

/** The record as the recorder writes it: tab-indented JSON with a trailing newline. */
const recordOf = ({ steps, updatedAt = '2026-09-10T10:12:10.000Z' }: { steps: PlanningStepRecord[]; updatedAt?: string }) => {
	const progress: PlanningProgress = { name, updatedAt, steps };

	return `${JSON.stringify(progress, null, '\t')}\n`;
};

/** When draft started in the record most cases share — a different minute from that record's last update. */
const draftStartedAt = '2026-09-10T10:11:50.000Z';

/** Verify-facts passed on its second attempt in 30 seconds, starting 90 seconds before the system time, and draft is running under `draftPid`. */
const sampleRecord = ({ draftPid }: { draftPid: number }) =>
	recordOf({
		steps: [
			entryOf({
				step: PlanningStep.VerifyFacts,
				status: RunStatus.Passed,
				attempts: 2,
				startedAt: '2026-09-10T10:11:00.000Z',
				finishedAt: '2026-09-10T10:11:30.000Z',
				durationMs: 30_000,
			}),
			entryOf({ step: PlanningStep.Draft, status: RunStatus.Running, pid: draftPid, startedAt: draftStartedAt }),
		],
		updatedAt: '2026-09-10T10:12:10.000Z',
	});

/** When grade finished in the all-finished record — later than every other step, publish included. */
const gradeFinishedAt = '2026-09-10T10:11:40.000Z';

/** Every step finished; grade failed, and finished after the others even though publish sits after it in the record. */
const finishedRecord = () =>
	recordOf({
		steps: [
			entryOf({
				step: PlanningStep.VerifyFacts,
				status: RunStatus.Passed,
				startedAt: '2026-09-10T10:05:00.000Z',
				finishedAt: '2026-09-10T10:06:00.000Z',
				durationMs: 60_000,
			}),
			entryOf({
				step: PlanningStep.Draft,
				status: RunStatus.Passed,
				startedAt: '2026-09-10T10:06:10.000Z',
				finishedAt: '2026-09-10T10:07:10.000Z',
				durationMs: 60_000,
			}),
			entryOf({
				step: PlanningStep.Dedup,
				status: RunStatus.Passed,
				startedAt: '2026-09-10T10:07:20.000Z',
				finishedAt: '2026-09-10T10:08:20.000Z',
				durationMs: 60_000,
			}),
			entryOf({ step: PlanningStep.Grade, status: RunStatus.Failed, startedAt: '2026-09-10T10:09:00.000Z', finishedAt: gradeFinishedAt, durationMs: 160_000 }),
			entryOf({
				step: PlanningStep.Publish,
				status: RunStatus.Passed,
				startedAt: '2026-09-10T10:08:30.000Z',
				finishedAt: '2026-09-10T10:08:50.000Z',
				durationMs: 20_000,
			}),
		],
		updatedAt: gradeFinishedAt,
	});

/**
 * A fresh checkout with only the clock faked, so every clock the block draws is
 * known while the file reads stay real. `folder: false` leaves the plan folder
 * out entirely; `record` is written verbatim as the planning record when given.
 */
const setupPlanningBlock = async ({ record, folder = true }: { record?: string; folder?: boolean } = {}) => {
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
	const planDir = join(cwd, '.lightsout', 'plans', name);
	const recordPath = join(planDir, 'planning-progress.json');

	if (folder) {
		mkdirSync(planDir, { recursive: true });
	}

	if (record !== undefined) {
		writeFileSync(recordPath, record);
	}

	return { cwd, recordPath };
};

describe('loadPlanningProgressBlock', () => {
	test.each([
		{ folder: true, record: undefined },
		{ folder: false, record: undefined },
		{ folder: true, record: recordOf({ steps: [] }) },
	])('a plan with no planning record shows all five steps not reached and says no step has run yet', async ({ folder, record }) => {
		const { cwd } = await setupPlanningBlock({ folder, record });

		const lines = await loadPlanningProgressBlock({ cwd, name });

		expect(lines).toHaveLength(10);
		expect(lines.slice(2, 7)).toStrictEqual([notReached.verifyFacts, notReached.draft, notReached.dedup, notReached.grade, notReached.publish]);
		expect(lines.at(-2)).toBe(' elapsed 0m 00s · 0 of 5 passed');
		expect(lines.at(-1)).toMatch(/^ now {2}.*no step has run yet/i);
	});

	test.each([
		{ record: '{ this is not json\n' },
		{
			record: `${JSON.stringify({
				name,
				updatedAt: '2026-09-10T10:12:10.000Z',
				steps: [{ step: 'lint', status: 'passed', attempts: 1, pid: 1, startedAt: '2026-09-10T10:11:00.000Z' }],
			})}\n`,
		},
	])('an unreadable planning record prints one line naming the file', async ({ record }) => {
		const { cwd, recordPath } = await setupPlanningBlock({ record });

		const lines = await loadPlanningProgressBlock({ cwd, name });

		expect(lines).toEqual([expect.stringContaining(recordPath)]);
	});

	test('a step whose recording process is alive shows as running and the now line names it', async () => {
		const { cwd } = await setupPlanningBlock({ record: sampleRecord({ draftPid: process.pid }) });

		const lines = await loadPlanningProgressBlock({ cwd, name });

		expect(lines.slice(2, 7)).toEqual([
			' ✓  verify-facts         passed (x2)       0m 30s',
			expect.stringMatching(/^ ▶ {2}draft +running +0m 40s$/),
			notReached.dedup,
			notReached.grade,
			notReached.publish,
		]);
		expect(lines.at(-2)).toMatch(/ · 1 of 5 passed$/);
		expect(lines.at(-1)).toMatch(/^ now {2}.*draft/);
		expect(lines.at(-1)).toMatch(/running/i);
		expect(lines.at(-1)).toContain(localClock({ iso: draftStartedAt }));
	});

	test('a running step whose recording process is gone is not shown as running, and the now line gives the last update time', async () => {
		const { cwd } = await setupPlanningBlock({ record: sampleRecord({ draftPid: deadPid }) });

		const lines = await loadPlanningProgressBlock({ cwd, name });

		const draftRow = lines[3] ?? '';

		expect(draftRow).toMatch(/^ ✗ {2}draft +failed\b/);
		expect(draftRow).not.toMatch(/\d+m \d{2}s/);
		expect(lines.some((line) => line.includes('▶'))).toBe(false);
		expect(lines.at(-1)).toMatch(/^ now {2}.*draft/);
		expect(lines.at(-1)).toMatch(/no live process/i);
		expect(lines.at(-1)).toContain(localClock({ iso: '2026-09-10T10:12:10.000Z' }));
	});

	test.each([{ record: sampleRecord({ draftPid: process.pid }) }, { record: finishedRecord() }, { record: recordOf({ steps: [] }) }])(
		'the title line carries the plan name and the planning tag, flush with the rule',
		async ({ record }) => {
			const { cwd } = await setupPlanningBlock({ record });

			const lines = await loadPlanningProgressBlock({ cwd, name });

			expect(lines[0]).toMatch(/^demo +planning$/);
			expect(lines[0]).toHaveLength((lines[1] ?? '').length);
		},
	);

	test.each([
		{ record: sampleRecord({ draftPid: process.pid }), totals: ' elapsed 1m 30s · 1 of 5 passed' },
		{ record: undefined, totals: ' elapsed 0m 00s · 0 of 5 passed' },
	])('the totals line gives wall time since the first step started and how many of the five steps passed', async ({ record, totals }) => {
		const { cwd } = await setupPlanningBlock({ record });

		const lines = await loadPlanningProgressBlock({ cwd, name });

		expect(lines.at(-2)).toBe(totals);
	});

	test.each([
		{
			// the dead entry started later, so the live one wins on liveness, not on its start time
			steps: [
				entryOf({ step: PlanningStep.Draft, status: RunStatus.Running, startedAt: '2026-09-10T10:11:00.000Z' }),
				entryOf({ step: PlanningStep.Dedup, status: RunStatus.Running, pid: deadPid, startedAt: '2026-09-10T10:12:00.000Z' }),
			],
			named: 'draft',
			other: 'dedup',
			says: /running/i,
			saysNot: /no live process/i,
		},
		{
			// the passed entry finished after the dead one started, and still the dead one is named
			steps: [
				entryOf({ step: PlanningStep.Draft, status: RunStatus.Running, pid: deadPid, startedAt: '2026-09-10T10:11:00.000Z' }),
				entryOf({
					step: PlanningStep.Dedup,
					status: RunStatus.Passed,
					startedAt: '2026-09-10T10:11:10.000Z',
					finishedAt: '2026-09-10T10:12:00.000Z',
					durationMs: 50_000,
				}),
			],
			named: 'draft',
			other: 'dedup',
			says: /no live process/i,
			saysNot: /\bpassed\b/i,
		},
	])('the now line prefers a live running step, then a dead running step, over a step that finished', async ({ steps, named, other, says, saysNot }) => {
		const { cwd } = await setupPlanningBlock({ record: recordOf({ steps }) });

		const lines = await loadPlanningProgressBlock({ cwd, name });

		const nowLine = lines.at(-1) ?? '';

		expect(nowLine).toMatch(/^ now {2}/);
		expect(nowLine).toContain(named);
		expect(nowLine).not.toContain(other);
		expect(nowLine).toMatch(says);
		expect(nowLine).not.toMatch(saysNot);
	});

	test('with no step running, the now line names the step that finished last and how it ended', async () => {
		const { cwd } = await setupPlanningBlock({ record: finishedRecord() });

		const lines = await loadPlanningProgressBlock({ cwd, name });

		const nowLine = lines.at(-1) ?? '';

		expect(lines.some((line) => line.includes('▶'))).toBe(false);
		expect(nowLine).toMatch(/^ now {2}.*grade/);
		expect(nowLine).toMatch(/failed/i);
		expect(nowLine).toContain(localClock({ iso: gradeFinishedAt }));
		expect(nowLine).not.toMatch(/verify-facts|draft|dedup|publish/);
	});
});
