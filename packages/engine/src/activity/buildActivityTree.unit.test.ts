import { describe, expect, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/buildActivityTree.ts';
import type { ActivityLevelEnd } from '#src/contracts/activity/ActivityLevelEnd.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityLevelStart } from '#src/contracts/activity/ActivityLevelStart.ts';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import { ActivityReport } from '#src/contracts/activity/ActivityReport.ts';
import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import type { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';
import { ProcessEndReason } from '#src/contracts/activity/ProcessEndReason.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';

/** One level opening, carrying only what a case varies. */
const levelStart = ({
	id,
	parentId,
	level = ActivityLevelKind.CommandRun,
	label = id,
	at,
}: {
	id: string;
	parentId?: string;
	level?: ActivityLevelKind;
	label?: string;
	at: string;
}): ActivityLevelStart => ({
	kind: ActivityMarkKind.LevelStart,
	id,
	parentId,
	level,
	label,
	at,
});

/** One level closing. Every case here settles the same way unless it says otherwise. */
const levelEnd = ({ id, at, outcome = RunStatus.Passed }: { id: string; at: string; outcome?: RunStatus }): ActivityLevelEnd => ({
	kind: ActivityMarkKind.LevelEnd,
	id,
	at,
	outcome,
});

/** One harness process inside a level — the only thing that carries spend or agent time. */
const harnessProcess = ({
	levelId,
	startedAt,
	endedAt,
	usage,
}: {
	levelId: string;
	startedAt: string;
	endedAt: string;
	usage?: HarnessProcessUsage;
}): HarnessProcessMark => ({
	kind: ActivityMarkKind.HarnessProcess,
	levelId,
	harness: 'stub',
	spawn: 1,
	reemit: false,
	startedAt,
	endedAt,
	endReason: ProcessEndReason.Completed,
	usage,
});

/** One plan folder written by two command processes, one after the other. */
const setupTwoCommandRuns = () => ({
	marks: [
		levelStart({ id: 'my-plan', level: ActivityLevelKind.Plan, at: '2026-09-17T00:00:00.000Z' }),
		levelEnd({ id: 'my-plan', at: '2026-09-17T00:00:10.000Z' }),
		levelStart({ id: 'my-plan', level: ActivityLevelKind.Plan, at: '2026-09-17T00:00:20.000Z' }),
		levelEnd({ id: 'my-plan', at: '2026-09-17T00:00:30.000Z' }),
	],
});

/** A plan whose command run finished and whose own closing line was never written. */
const setupCrashedPlan = () => ({
	marks: [
		levelStart({ id: 'my-plan', level: ActivityLevelKind.Plan, at: '2026-09-17T00:00:00.000Z' }),
		levelStart({ id: 'run-1', parentId: 'my-plan', at: '2026-09-17T00:00:01.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:05.000Z' }),
	],
});

/** One level holding two processes whose windows overlap by two seconds. */
const setupOverlappingProcesses = () => ({
	marks: [
		levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({ levelId: 'run-1', startedAt: '2026-09-17T00:00:00.000Z', endedAt: '2026-09-17T00:00:06.000Z' }),
		harnessProcess({ levelId: 'run-1', startedAt: '2026-09-17T00:00:04.000Z', endedAt: '2026-09-17T00:00:08.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:10.000Z' }),
	],
});

/** A ten-second level in which an agent ran for three seconds. */
const setupMostlyIdleLevel = () => ({
	marks: [
		levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({ levelId: 'run-1', startedAt: '2026-09-17T00:00:02.000Z', endedAt: '2026-09-17T00:00:05.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:10.000Z' }),
	],
});

/** Two processes that reported input tokens and no cost at all. */
const setupUsageWithoutCost = () => ({
	marks: [
		levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({
			levelId: 'run-1',
			startedAt: '2026-09-17T00:00:00.000Z',
			endedAt: '2026-09-17T00:00:02.000Z',
			usage: { inputTokens: 10 },
		}),
		harnessProcess({
			levelId: 'run-1',
			startedAt: '2026-09-17T00:00:02.000Z',
			endedAt: '2026-09-17T00:00:04.000Z',
			usage: { inputTokens: 5 },
		}),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:04.000Z' }),
	],
});

/** A record whose opening lines are missing, so a level names a parent nothing ever started. */
const setupOrphanedLevel = () => ({
	marks: [
		levelStart({ id: 'orphan-run', parentId: 'never-started', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({ levelId: 'orphan-run', startedAt: '2026-09-17T00:00:00.000Z', endedAt: '2026-09-17T00:00:03.000Z' }),
		levelEnd({ id: 'orphan-run', at: '2026-09-17T00:00:03.000Z' }),
	],
});

/** Two separate roots, each with one process, so the report has something to add together. */
const setupTwoRoots = () => ({
	marks: [
		levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({ levelId: 'run-1', startedAt: '2026-09-17T00:00:00.000Z', endedAt: '2026-09-17T00:00:05.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:10.000Z' }),
		levelStart({ id: 'run-2', at: '2026-09-17T00:00:20.000Z' }),
		harnessProcess({ levelId: 'run-2', startedAt: '2026-09-17T00:00:20.000Z', endedAt: '2026-09-17T00:00:24.000Z' }),
		levelEnd({ id: 'run-2', at: '2026-09-17T00:00:30.000Z' }),
	],
});

/** A process naming a level no start mark ever opened — the record's opening line lost. */
const setupProcessWithoutLevel = () => ({
	marks: [
		levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({ levelId: 'never-started', startedAt: '2026-09-17T00:00:01.000Z', endedAt: '2026-09-17T00:00:06.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:10.000Z' }),
	],
});

/** A closing line for a level whose opening line the record never held. */
const setupEndWithoutStart = () => ({
	marks: [
		levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:10.000Z' }),
		levelEnd({ id: 'never-started', at: '2026-09-17T00:00:20.000Z', outcome: RunStatus.Failed }),
	],
});

/** One plan's two command runs, the later window written to the record first. */
const setupOutOfOrderMarks = () => ({
	marks: [
		levelStart({ id: 'my-plan', level: ActivityLevelKind.Plan, at: '2026-09-17T00:00:20.000Z' }),
		levelEnd({ id: 'my-plan', at: '2026-09-17T00:00:30.000Z' }),
		levelStart({ id: 'my-plan', level: ActivityLevelKind.Plan, at: '2026-09-17T00:00:00.000Z' }),
		levelEnd({ id: 'my-plan', at: '2026-09-17T00:00:10.000Z', outcome: RunStatus.Failed }),
	],
});

/** A record that held no readable line at all. */
const setupEmptyRecord = () => ({ marks: [] as ActivityMark[] });

/** A finished plan, one command run below it, one step below that, one process on the step. */
const setupNestedPlan = () => ({
	marks: [
		levelStart({ id: 'my-plan', level: ActivityLevelKind.Plan, at: '2026-09-17T00:00:00.000Z' }),
		levelStart({ id: 'run-1', parentId: 'my-plan', at: '2026-09-17T00:00:01.000Z' }),
		levelStart({ id: 'step-1', parentId: 'run-1', level: ActivityLevelKind.Step, label: 'draft', at: '2026-09-17T00:00:02.000Z' }),
		harnessProcess({
			levelId: 'step-1',
			startedAt: '2026-09-17T00:00:02.000Z',
			endedAt: '2026-09-17T00:00:05.000Z',
			usage: { inputTokens: 40, costUsd: 0 },
		}),
		levelEnd({ id: 'step-1', at: '2026-09-17T00:00:06.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:07.000Z' }),
		levelEnd({ id: 'my-plan', at: '2026-09-17T00:00:08.000Z' }),
	],
});

describe('buildActivityTree', () => {
	test('a level id started twice folds into one node spanning both windows', () => {
		const { marks } = setupTwoCommandRuns();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		expect(report.roots).toEqual([
			expect.objectContaining({
				id: 'my-plan',
				startedAt: '2026-09-17T00:00:00.000Z',
				endedAt: '2026-09-17T00:00:30.000Z',
			}),
		]);
	});

	test('a level with no end mark is unfinished and carries no wall time', () => {
		const { marks } = setupCrashedPlan();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		const [plan] = report.roots;
		expect(plan.endedAt).toBeUndefined();
		expect(plan.totals.wallMs).toBeUndefined();
		expect(plan.totals.idleMs).toBeUndefined();
		expect(plan.children[0].endedAt).toBe('2026-09-17T00:00:05.000Z');
	});

	test('overlapping processes sum into agent time once each with peak concurrency two', () => {
		const { marks } = setupOverlappingProcesses();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		expect(report.roots[0].totals).toEqual(
			expect.objectContaining({
				agentMs: 10_000,
				busyMs: 8_000,
				peakProcesses: 2,
				processCount: 2,
			}),
		);
	});

	test("idle time is the level's wall time minus the time any process was running", () => {
		const { marks } = setupMostlyIdleLevel();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		expect(report.roots[0].totals).toEqual(
			expect.objectContaining({
				wallMs: 10_000,
				busyMs: 3_000,
				idleMs: 7_000,
			}),
		);
	});

	test('a total keeps an unreported field absent rather than zeroing it', () => {
		const { marks } = setupUsageWithoutCost();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		// toEqual ignores an absent key and an explicit undefined alike, and fails
		// on a 0 — which is the whole distinction this row exists to pin.
		expect(report.roots[0].totals.usage).toEqual({ inputTokens: 15 });
	});

	test('a level whose parent was never started is kept as a root', () => {
		const { marks } = setupOrphanedLevel();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		expect(report.roots).toEqual([
			expect.objectContaining({
				id: 'orphan-run',
				totals: expect.objectContaining({ processCount: 1, agentMs: 3_000 }),
			}),
		]);
	});

	test('the report names its plan and totals every root', () => {
		const { marks } = setupTwoRoots();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		expect(report).toEqual(
			expect.objectContaining({
				plan: 'my-plan',
				totals: expect.objectContaining({
					wallMs: 30_000,
					agentMs: 9_000,
					busyMs: 9_000,
					processCount: 2,
				}),
			}),
		);
	});

	test('a process naming a level nothing started counts toward no total', () => {
		const { marks } = setupProcessWithoutLevel();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		// the process has no window to sit inside, and inventing one would put
		// five seconds of agent time where nothing was recorded as happening
		expect(report.roots[0].processes).toStrictEqual([]);
		expect(report.roots[0].totals).toEqual(expect.objectContaining({ processCount: 0, agentMs: 0, busyMs: 0, peakProcesses: 0 }));
	});

	test('an end mark for a level that was never started is ignored', () => {
		const { marks } = setupEndWithoutStart();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		// a closing line with nothing to close opens no row of its own: a level
		// the record never started has no start time to report it from
		expect(report.roots).toEqual([expect.objectContaining({ id: 'run-1', endedAt: '2026-09-17T00:00:10.000Z', outcome: 'passed' })]);
	});

	test('marks written out of order span the earliest start and the latest end', () => {
		const { marks } = setupOutOfOrderMarks();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		// the window is the earliest start to the latest end, whatever order the
		// lines reached the file in — two command processes append as they finish
		expect(report.roots[0]).toEqual(
			expect.objectContaining({
				startedAt: '2026-09-17T00:00:00.000Z',
				endedAt: '2026-09-17T00:00:30.000Z',
				outcome: 'passed',
				totals: expect.objectContaining({ wallMs: 30_000 }),
			}),
		);
	});

	test('a record holding no marks reports no roots and no totals', () => {
		const { marks } = setupEmptyRecord();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		expect(report).toStrictEqual({
			plan: 'my-plan',
			roots: [],
			totals: { wallMs: undefined, agentMs: 0, busyMs: 0, idleMs: undefined, peakProcesses: 0, processCount: 0, usage: {} },
		});
	});

	test('a nested report satisfies the activity report contract at every depth', () => {
		const { marks } = setupNestedPlan();

		const report = buildActivityTree({ plan: 'my-plan', marks });

		// The fold's answer is what a reader validates and what a data-shaped
		// report prints, so it has to hold up against the contract through the
		// children the schema reaches by its own cycle — not only at the roots.
		const parsed = ActivityReport.parse(report);
		expect(parsed.roots[0].children[0].children[0]).toEqual(
			expect.objectContaining({
				id: 'step-1',
				level: 'step',
				label: 'draft',
				startedAt: '2026-09-17T00:00:02.000Z',
				endedAt: '2026-09-17T00:00:06.000Z',
				outcome: 'passed',
				processes: [expect.objectContaining({ levelId: 'step-1', endReason: 'completed', usage: { inputTokens: 40, costUsd: 0 } })],
				// a cost the harness stated as zero is a stated zero all the way up,
				// where an unreported one would have stayed absent
				totals: expect.objectContaining({
					wallMs: 4_000,
					agentMs: 3_000,
					busyMs: 3_000,
					idleMs: 1_000,
					peakProcesses: 1,
					processCount: 1,
					usage: { inputTokens: 40, costUsd: 0 },
				}),
			}),
		);
	});
});
