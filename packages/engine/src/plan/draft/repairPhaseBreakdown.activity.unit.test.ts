import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type ActivityLevel, buildActivityTree, createActivityRecorder, readActivityMarks } from '#src/activity/index.ts';
import { ActivityLevelKind, type ActivityNode, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { repairPhaseBreakdown } from '#src/plan/draft/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';

// What the reshape loop writes into the activity record: one pass level per
// round it actually spends, each holding that round's one spawn. The loop's own
// convergence is the sibling suite's subject — here only the recorded shape and
// the outcome each row closes with are read.

/** An overview whose phases declare the given created-file counts — anything over 30 is the blocking size defect a round is spent on. */
const overviewCreating = ({ counts }: { counts: number[] }) =>
	overviewBody({ rows: counts.map((created, index) => ({ number: index + 1, file: `phase${index + 1}-step.md`, created, touched: 1 })) });

/**
 * A plan workspace holding one authored overview, an already-open command-run
 * level for the rounds to hang from, and a reshaper that rewrites the overview
 * with `bodies` in call order — or parks on every call when `parked` is set.
 */
const setupReshapeActivity = ({ counts, bodies = [], parked = false }: { counts: number[]; bodies?: string[]; parked?: boolean }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-breakdown-activity-'));
	const workspaceDir = join(cwd, '.lightsout', 'tickets', 'demo', 'plans');

	mkdirSync(workspaceDir, { recursive: true });

	const overviewPath = join(workspaceDir, 'overview.md');

	writeFileSync(overviewPath, overviewCreating({ counts }));

	let call = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (parked) {
				return { text: '', exitCode: 1, rateLimited: true };
			}

			const path = /- (\S+overview\.md)/.exec(prompt)?.[1] ?? '';
			const body = bodies[Math.min(call, bodies.length - 1)] ?? '';

			call += 1;
			writeFileSync(path, body);

			return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
		},
	};
	const plan = createActivityRecorder({ dir: workspaceDir, level: ActivityLevelKind.Plan, label: 'demo' });
	const level = plan.open({ level: ActivityLevelKind.CommandRun, label: 'plan draft' });

	return {
		level,
		workspaceDir,
		params: { cwd, driver, name: 'demo', overviewPath, workspaceDir, executorFileLimit: 50, timeoutMs: 60_000, level, progress: () => {} },
	};
};

/** Close the command run, let every mark reach disk, and answer the folded command-run node. */
const readCommandRun = async ({ level, workspaceDir }: { level: ActivityLevel; workspaceDir: string }): Promise<ActivityNode> => {
	level.close({ outcome: RunStatus.Passed });
	await level.settled();

	const { roots } = buildActivityTree({ plan: 'demo', marks: await readActivityMarks({ dir: workspaceDir }) });
	const commandRun = roots[0]?.children[0];

	expectDefined(commandRun);

	return commandRun;
};

/** Each pass level under the command run as the row a report would draw it: its label, its outcome, and the steps hanging off it. */
const reshapeRows = ({ node }: { node: ActivityNode }) =>
	node.children
		.filter(({ level }) => level === ActivityLevelKind.Pass)
		.map(({ label, outcome, children }) => ({
			label,
			outcome,
			steps: children.map((step) => ({ level: step.level, label: step.label, outcome: step.outcome })),
		}));

describe('repairPhaseBreakdown activity levels', () => {
	test('each reshape round is its own pass level holding that round’s one spawn', async () => {
		const { level, params, workspaceDir } = setupReshapeActivity({
			counts: [31, 31],
			bodies: [overviewCreating({ counts: [31, 1] }), overviewCreating({ counts: [1, 1] })],
		});

		const result = await repairPhaseBreakdown(params);
		const commandRun = await readCommandRun({ level, workspaceDir });

		expectStatus(result, 'complete');
		// Two rounds, two rows, and each row's label carries the same number as the
		// transcript its spawn wrote — which is what makes a row in the report and
		// a file in the plan folder findable from each other. Collapsed into one
		// row, the report could not say which round burned the time.
		expect(reshapeRows({ node: commandRun })).toStrictEqual([
			{
				label: 'breakdown reshape 1',
				outcome: RunStatus.Passed,
				steps: [{ level: ActivityLevelKind.Step, label: 'breakdown-repair-1', outcome: RunStatus.Passed }],
			},
			{
				label: 'breakdown reshape 2',
				outcome: RunStatus.Passed,
				steps: [{ level: ActivityLevelKind.Step, label: 'breakdown-repair-2', outcome: RunStatus.Passed }],
			},
		]);
	});

	test('a breakdown that already fits opens no pass level at all', async () => {
		const { level, params, workspaceDir } = setupReshapeActivity({ counts: [1] });

		const result = await repairPhaseBreakdown(params);
		const commandRun = await readCommandRun({ level, workspaceDir });

		expectStatus(result, 'complete');
		// The deterministic check spends no agent, so there is nothing for a row to
		// report. An empty pass row here would bill a reshape that never ran.
		expect({ findings: result.findings, children: commandRun.children }).toStrictEqual({ findings: [], children: [] });
	});

	test('a round that hits the rate-limit wall closes parked rather than failed', async () => {
		const { level, params, workspaceDir } = setupReshapeActivity({ counts: [31], parked: true });

		const result = await repairPhaseBreakdown(params);
		const commandRun = await readCommandRun({ level, workspaceDir });

		expectStatus(result, 'paused-rate-limit');
		// The wall is a resumable state the engine already spells that way, so the
		// row has to say so: recorded as a failure, the report would send a human
		// hunting a defect where the answer is to re-run later.
		expect(reshapeRows({ node: commandRun })).toStrictEqual([
			{
				label: 'breakdown reshape 1',
				outcome: RunStatus.PausedRateLimit,
				steps: [{ level: ActivityLevelKind.Step, label: 'breakdown-repair-1', outcome: RunStatus.PausedRateLimit }],
			},
		]);
	});
});
