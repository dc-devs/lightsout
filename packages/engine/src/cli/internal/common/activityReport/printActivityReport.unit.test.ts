import { expect, jest, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/buildActivityTree.ts';
import { printActivityReport } from '#src/cli/internal/common/activityReport/printActivityReport.ts';
import type { ActivityLevelEnd } from '#src/contracts/activity/ActivityLevelEnd.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityLevelStart } from '#src/contracts/activity/ActivityLevelStart.ts';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import type { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';
import { ProcessEndReason } from '#src/contracts/activity/ProcessEndReason.ts';
import { Effort } from '#src/contracts/Effort.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { PlanActivityReport } from '#src/views/common/types/PlanActivityReport.ts';

/** One level opening, carrying only what a case varies. */
const levelStart = ({
	id,
	parentId,
	level = ActivityLevelKind.Step,
	label = id,
	at,
}: {
	id: string;
	parentId?: string;
	level?: ActivityLevelKind;
	label?: string;
	at: string;
}): ActivityLevelStart => ({ kind: ActivityMarkKind.LevelStart, id, parentId, level, label, at });

/** One level closing. Every case here settles the same way. */
const levelEnd = ({ id, at }: { id: string; at: string }): ActivityLevelEnd => ({
	kind: ActivityMarkKind.LevelEnd,
	id,
	at,
	outcome: RunStatus.Passed,
});

/** One harness process — the only thing that carries agent time or spend. */
const harnessProcess = ({
	levelId,
	harness = 'claude-code',
	model,
	effort,
	startedAt,
	endedAt,
	endReason = ProcessEndReason.Completed,
	usage,
}: {
	levelId: string;
	harness?: string;
	model?: string;
	effort?: Effort;
	startedAt: string;
	endedAt: string;
	endReason?: ProcessEndReason;
	usage?: HarnessProcessUsage;
}): HarnessProcessMark => ({
	kind: ActivityMarkKind.HarnessProcess,
	levelId,
	harness,
	model,
	effort,
	spawn: 1,
	reemit: false,
	startedAt,
	endedAt,
	endReason,
	usage,
});

// The printed answer IS its console.log lines, so capturing them is the
// arrangement. isTTY is pinned off so the ANSI paint helpers stay no-ops and
// the assertions read the plain text a piped consumer sees.
const captureLines = () => {
	const logged: string[] = [];

	process.stdout.isTTY = false;

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	return logged;
};

/** Row cells with the alignment padding stripped — the content contract, read apart from the column widths. */
const cellsOf = ({ logged }: { logged: string[] }) =>
	logged
		.filter((line) => line.startsWith('│'))
		.map((line) =>
			line
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

/**
 * Everything printed after the plan's tree closed — the outlier section alone.
 * Read this way rather than by searching the whole output, because the tree's
 * own process rows name the same harness, model and end reason the outlier
 * section does, so a whole-output search would pass on the tree alone.
 */
const afterTree = ({ logged }: { logged: string[] }) => logged.slice(logged.findIndex((line) => line.startsWith('└')) + 1).join('\n');

/**
 * One plan whose three steps ran one process each: a slow one killed at its
 * ceiling, an expensive one, and a cheap quick one that is neither.
 */
const setupPlanWithOutliers = ({ costs = true }: { costs?: boolean } = {}) => {
	const marks: ActivityMark[] = [
		levelStart({ id: 'plan-1', level: ActivityLevelKind.Plan, label: 'my-plan', at: '2026-09-17T00:00:00.000Z' }),
		levelStart({ id: 'run-1', parentId: 'plan-1', level: ActivityLevelKind.CommandRun, label: 'plan draft', at: '2026-09-17T00:00:00.000Z' }),
		levelStart({ id: 'step-grade', parentId: 'run-1', label: 'grade-gap', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({
			levelId: 'step-grade',
			harness: 'claude-code',
			model: 'opus-slow',
			effort: Effort.High,
			startedAt: '2026-09-17T00:00:00.000Z',
			endedAt: '2026-09-17T00:01:40.000Z',
			endReason: ProcessEndReason.TimedOut,
			usage: costs ? { inputTokens: 900, costUsd: 0.1 } : { inputTokens: 900 },
		}),
		levelEnd({ id: 'step-grade', at: '2026-09-17T00:01:40.000Z' }),
		levelStart({ id: 'step-draft', parentId: 'run-1', label: 'draft-plan', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({
			levelId: 'step-draft',
			harness: 'pi',
			model: 'pricey-mini',
			effort: Effort.Low,
			startedAt: '2026-09-17T00:00:00.000Z',
			endedAt: '2026-09-17T00:00:05.000Z',
			usage: costs ? { inputTokens: 800, costUsd: 9.99 } : { inputTokens: 800 },
		}),
		levelEnd({ id: 'step-draft', at: '2026-09-17T00:00:05.000Z' }),
		levelStart({ id: 'step-lint', parentId: 'run-1', label: 'lint-plan', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({
			levelId: 'step-lint',
			harness: 'omp',
			model: 'cheap-nano',
			effort: Effort.Medium,
			startedAt: '2026-09-17T00:00:00.000Z',
			endedAt: '2026-09-17T00:00:01.000Z',
			usage: costs ? { inputTokens: 700, costUsd: 0.01 } : { inputTokens: 700 },
		}),
		levelEnd({ id: 'step-lint', at: '2026-09-17T00:00:01.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:02:00.000Z' }),
		levelEnd({ id: 'plan-1', at: '2026-09-17T00:02:00.000Z' }),
	];
	const plans: PlanActivityReport[] = [{ name: 'my-plan', report: buildActivityTree({ plan: 'my-plan', marks }) }];

	return { plans, logged: captureLines() };
};

/**
 * A ticket holding two plans whose processes overlap ACROSS the two plans.
 *
 * Each plan's own busiest instant holds two processes; the ticket's holds
 * three, and the two plans added would say four. Nothing but the shared
 * ticket-wide fold can answer three.
 */
const setupTicketWithCrossPlanOverlap = () => {
	const planA: ActivityMark[] = [
		levelStart({ id: 'run-a', level: ActivityLevelKind.CommandRun, label: 'plan draft', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({
			levelId: 'run-a',
			model: 'model-a',
			startedAt: '2026-09-17T00:00:00.000Z',
			endedAt: '2026-09-17T00:00:10.000Z',
			usage: { inputTokens: 800 },
		}),
		harnessProcess({
			levelId: 'run-a',
			model: 'model-a',
			startedAt: '2026-09-17T00:00:02.000Z',
			endedAt: '2026-09-17T00:00:04.000Z',
			usage: { inputTokens: 900 },
		}),
		levelEnd({ id: 'run-a', at: '2026-09-17T00:00:10.000Z' }),
	];
	const planB: ActivityMark[] = [
		levelStart({ id: 'run-b', level: ActivityLevelKind.CommandRun, label: 'plan grade', at: '2026-09-17T00:00:06.000Z' }),
		harnessProcess({
			levelId: 'run-b',
			model: 'model-b',
			startedAt: '2026-09-17T00:00:06.000Z',
			endedAt: '2026-09-17T00:00:12.000Z',
			usage: { inputTokens: 700 },
		}),
		harnessProcess({
			levelId: 'run-b',
			model: 'model-b',
			startedAt: '2026-09-17T00:00:08.000Z',
			endedAt: '2026-09-17T00:00:14.000Z',
			usage: { inputTokens: 600 },
		}),
		levelEnd({ id: 'run-b', at: '2026-09-17T00:00:16.000Z' }),
	];
	const plans: PlanActivityReport[] = [
		{ name: 'my-ticket/plan-a', report: buildActivityTree({ plan: 'my-ticket/plan-a', marks: planA }) },
		{ name: 'my-ticket/plan-b', report: buildActivityTree({ plan: 'my-ticket/plan-b', marks: planB }) },
	];

	return { plans, logged: captureLines() };
};

/** A ticket whose second plan folder was written before this feature existed, so it holds no record at all. */
const setupTicketWithAMissingRecord = () => {
	const marks: ActivityMark[] = [
		levelStart({ id: 'run-1', level: ActivityLevelKind.CommandRun, label: 'plan draft', at: '2026-09-17T00:00:00.000Z' }),
		levelStart({ id: 'step-draft', parentId: 'run-1', label: 'draft-plan', at: '2026-09-17T00:00:00.000Z' }),
		harnessProcess({
			levelId: 'step-draft',
			model: 'model-a',
			startedAt: '2026-09-17T00:00:00.000Z',
			endedAt: '2026-09-17T00:00:30.000Z',
			usage: { inputTokens: 800 },
		}),
		levelEnd({ id: 'step-draft', at: '2026-09-17T00:00:30.000Z' }),
		levelEnd({ id: 'run-1', at: '2026-09-17T00:00:30.000Z' }),
	];
	const plans: PlanActivityReport[] = [
		{ name: 'my-ticket/plan-a', report: buildActivityTree({ plan: 'my-ticket/plan-a', marks }) },
		{ name: 'my-ticket/plan-b', report: undefined },
	];

	return { plans, logged: captureLines() };
};

test('printActivityReport: the report names the slowest and most expensive individual harness processes', () => {
	const { plans, logged } = setupPlanWithOutliers();

	printActivityReport({ target: 'my-plan', workOrderFolder: false, plans });

	const outliers = afterTree({ logged });
	// the tree says which level was slow; this section says which single call to
	// open, which is why each entry has to carry the call's own identity
	expect(outliers).toContain('grade-gap');
	expect(outliers).toContain('claude-code');
	expect(outliers).toContain('opus-slow');
	expect(outliers).toContain('high');
	expect(outliers).toContain('timed-out');
	expect(outliers).toContain('draft-plan');
	expect(outliers).toContain('pricey-mini');
	expect(outliers).toContain('$9.99');
	expect(outliers).toMatch(/\bpi\b/);
});

test('printActivityReport: with no stated cost anywhere the expensive list is unavailable, never a ranking of zeros', () => {
	const { plans, logged } = setupPlanWithOutliers({ costs: false });

	printActivityReport({ target: 'my-plan', workOrderFolder: false, plans });

	const outliers = afterTree({ logged });
	expect(outliers).toContain('grade-gap');
	expect(outliers).toMatch(/unavailable/i);
	// a harness that stated no cost did not state a cost of nothing, so no
	// process may be ranked — or printed — as having spent zero dollars
	expect(outliers).not.toContain('$0.00');
});

test('printActivityReport: the ticket row is the shared ticket fold, not a sum of the plan rows', () => {
	const { plans, logged } = setupTicketWithCrossPlanOverlap();

	printActivityReport({ target: 'my-ticket', workOrderFolder: true, plans });

	const cells = cellsOf({ logged });
	// three processes ran at one instant across the two plans, which neither
	// plan's own row can show and which adding their peaks (four) is not
	expect(cells.some((row) => row.includes('3'))).toBe(true);
	expect(cells.some((row) => row.includes('4'))).toBe(false);
	// the figures that do add, added: ten plus two plus six plus six seconds
	expect(cells.some((row) => row.includes('24s'))).toBe(true);
});

test("printActivityReport: a ticket folder prints a totalled ticket row over each plan's own tree, and names a plan with no record", () => {
	const { plans, logged } = setupTicketWithAMissingRecord();

	printActivityReport({ target: 'my-ticket', workOrderFolder: true, plans });

	const output = logged.join('\n');
	const planRow = logged.findIndex((line) => line.includes('my-ticket/plan-a'));
	expect(output).toContain('my-ticket');
	expect(planRow).toBeGreaterThanOrEqual(0);
	// the plan's own tree is drawn beneath its row, not above it or instead of it
	expect(logged.findIndex((line) => line.includes('draft-plan'))).toBeGreaterThan(planRow);
	// a plan folder written before this feature existed has no record, and one
	// line saying so reads better than an empty table
	expect(logged.find((line) => line.includes('my-ticket/plan-b'))).toMatch(/activity record/i);
});
