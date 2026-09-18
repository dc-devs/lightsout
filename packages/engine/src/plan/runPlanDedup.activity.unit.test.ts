import { expect, test } from '@jest/globals';
import { type ActivityLevel, buildActivityTree, createActivityRecorder, readActivityMarks } from '#src/activity/index.ts';
import { ActivityLevelKind, type ActivityNode, RunStatus } from '#src/contracts/index.ts';
import { runPlanDedup } from '#src/plan/runPlanDedup.ts';
import { createDedupJudgeDriver } from '#tests/helpers/createDedupJudgeDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPhasedDedupPlan } from '#tests/helpers/seedPhasedDedupPlan.ts';

// What the judge fan-out writes into the activity record: one pass level over
// the whole fan-out, one step under it per plan file that had something to
// judge — and nothing at all when there was nothing to judge.

/** A phased repo, its judge stub, and an already-open command-run level for the run to hang its work from. */
const setupDedupActivity = ({ existing, phases, verdicts = [] }: { existing: string[]; phases: string[][]; verdicts?: unknown[] }) => {
	const { cwd, name, workspaceDir } = seedPhasedDedupPlan({ existing, phases });
	const plan = createActivityRecorder({ dir: workspaceDir, level: ActivityLevelKind.Plan, label: name });
	const level = plan.open({ level: ActivityLevelKind.CommandRun, label: 'plan dedup' });

	return { cwd, name, workspaceDir, level, driver: createDedupJudgeDriver({ verdicts }) };
};

/** Close the command run, let every mark reach disk, and answer the folded command-run level. */
const readCommandRun = async ({
	level,
	name,
	workspaceDir,
}: {
	level: ActivityLevel;
	name: string;
	workspaceDir: string;
}): Promise<ActivityNode | undefined> => {
	level.close({ outcome: RunStatus.Passed });
	await level.settled();

	const report = buildActivityTree({ plan: name, marks: await readActivityMarks({ dir: workspaceDir }) });

	return report.roots.flatMap((root) => root.children).find((child) => child.level === ActivityLevelKind.CommandRun);
};

test('the judge fan-out is one pass level, and a no-op dedup opens none', async () => {
	const judged = setupDedupActivity({
		existing: ['src/fetchUser.ts', 'src/fetchOrder.ts'],
		phases: [['src/getUser.ts'], ['src/getOrder.ts']],
		verdicts: [
			{ plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' },
			{ plannedSymbol: 'getOrder', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchOrder already does this' },
		],
	});

	const judgedResult = await runPlanDedup({ cwd: judged.cwd, driver: judged.driver, name: judged.name, level: judged.level });
	const judgedRun = await readCommandRun(judged);

	expectStatus(judgedResult, 'complete');
	expectDefined(judgedRun);
	// the whole fan-out is one row, not one row per plan file and not a bare list
	// of steps hanging off the command run
	expect(judgedRun.children.map(({ level }) => level)).toStrictEqual([ActivityLevelKind.Pass]);

	const fanOut = judgedRun.children[0];

	// and under it, one step per plan file that actually had a judge spawned for
	// it, each named for the runner step whose transcript it can be found by
	expect(fanOut.children.map(({ level }) => level)).toStrictEqual([ActivityLevelKind.Step, ActivityLevelKind.Step]);
	expect(fanOut.children.map(({ label }) => label).sort()).toStrictEqual(['dedup-phase1-part', 'dedup-phase2-part']);

	const quiet = setupDedupActivity({ existing: ['src/fetchUser.ts'], phases: [['src/brandNewWidget.ts']] });

	const quietResult = await runPlanDedup({ cwd: quiet.cwd, driver: quiet.driver, name: quiet.name, level: quiet.level });
	const quietRun = await readCommandRun(quiet);

	expectStatus(quietResult, 'complete');
	expectDefined(quietRun);
	// nothing was judged, so no fan-out level is opened at all — an empty pass row
	// would report a grouping over zero spawns
	expect(quietRun.children).toStrictEqual([]);
	expect(quietResult.dedup.findings).toStrictEqual([]);
});
