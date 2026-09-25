import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/buildActivityTree.ts';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { createActivityRecorder } from '#src/activity/createActivityRecorder.ts';
import { readActivityMarks } from '#src/activity/readActivityMarks.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { runPhasesPipeline } from '#src/phases/runPhasesPipeline.ts';
import { readRunManifest } from '#src/runState/readRunManifest.ts';
import { createPhaseDriver } from '#tests/helpers/createPhaseDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { setupPhasedRepo } from '#tests/helpers/setupPhasedRepo.ts';

// What a phased run writes into the activity record: one pass level per phase
// that actually ran, hanging straight off the command run the caller opened —
// no coordinator level of its own, and nothing at all for a phase a resume
// finds already passed.

/** The plan folder a phased fixture's record is written into, and an already-open command-run level for the sequence to hang its phases from. */
const openCommandRun = ({ dir, label }: { dir: string; label: string }) => {
	const workspaceDir = join(dir, 'plans', 'demo');
	const plan = createActivityRecorder({ dir: workspaceDir, level: ActivityLevelKind.Plan, label: 'demo' });

	return { workspaceDir, level: plan.open({ level: ActivityLevelKind.CommandRun, label }) };
};

/** A fresh two-phase sequence, its stub harness, and the command-run level it is handed. */
const setupPhasedActivity = async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });

	return {
		dir,
		overviewPath,
		config: await readConfig({ cwd: dir }),
		driver: createPhaseDriver({ dir, seen: [] }),
		...openCommandRun({ dir, label: 'implement' }),
	};
};

/** A two-phase sequence whose second phase ends failed, so the sequence stops on it. */
const setupFailingPhasedActivity = async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });

	return {
		dir,
		overviewPath,
		config: await readConfig({ cwd: dir }),
		driver: createPhaseDriver({ dir, seen: [], failAt: 2 }),
		...openCommandRun({ dir, label: 'implement' }),
	};
};

/**
 * A two-phase sequence parked inside phase 2, so its first phase's step record
 * is already passed — plus a command-run level for the resume alone, since the
 * parking run is handed none.
 */
const setupResumedPhasedActivity = async () => {
	const { dir, overviewPath } = setupPhasedRepo({ phases: 2 });
	const config = await readConfig({ cwd: dir });
	const parked = await runPhasesPipeline({
		cwd: dir,
		driver: createPhaseDriver({ dir, seen: [], parkAt: 2 }),
		config,
		overviewPath,
		skipRefactor: true,
	});

	return {
		dir,
		config,
		driver: createPhaseDriver({ dir, seen: [] }),
		existing: await readRunManifest({ cwd: dir, runId: parked.manifest.runId }),
		...openCommandRun({ dir, label: 'resume' }),
	};
};

/** Close the command run, let every mark reach disk, and answer the folded command-run level. */
const readCommandRun = async ({ level, workspaceDir }: { level: ActivityLevel; workspaceDir: string }): Promise<ActivityNode | undefined> => {
	level.close({ outcome: RunStatus.Passed });
	await level.settled();

	const report = buildActivityTree({ plan: 'demo', marks: await readActivityMarks({ dir: workspaceDir }) });

	return report.roots.flatMap((root) => root.children).find((child) => child.level === ActivityLevelKind.CommandRun);
};

/** The phase levels a folded command run holds, as the three things the report draws from each row. */
const phaseRows = ({ commandRun }: { commandRun: ActivityNode }) => commandRun.children.map(({ level, label, outcome }) => ({ level, label, outcome }));

describe('runPhasesPipeline', () => {
	test('each phase opens one pass level labelled with its position and phase file', async () => {
		const phased = await setupPhasedActivity();

		const result = await runPhasesPipeline({
			cwd: phased.dir,
			driver: phased.driver,
			config: phased.config,
			overviewPath: phased.overviewPath,
			skipRefactor: true,
			level: phased.level,
		});
		const commandRun = await readCommandRun(phased);

		expect(result.ok).toBe(true);
		expectDefined(commandRun);
		// one pass row per phase, hanging straight off the command run: a single
		// row would mean the phases were flattened, and a single non-phase row
		// would mean a coordinator level sits between them and the command run
		expect(phaseRows({ commandRun })).toStrictEqual([
			{ level: ActivityLevelKind.Pass, label: 'phase 1/2: phase1.md', outcome: 'passed' },
			{ level: ActivityLevelKind.Pass, label: 'phase 2/2: phase2.md', outcome: 'passed' },
		]);
	});

	test('a phase already passed opens no pass level', async () => {
		const resumed = await setupResumedPhasedActivity();

		const result = await runPhasesPipeline({
			cwd: resumed.dir,
			driver: resumed.driver,
			config: resumed.config,
			existing: resumed.existing,
			skipRefactor: true,
			level: resumed.level,
		});
		const commandRun = await readCommandRun(resumed);

		// the premise: the first phase's step record was already passed
		expect(resumed.existing.steps[0]?.status).toBe('passed');
		expect(result.ok).toBe(true);
		expectDefined(commandRun);
		// only the unfinished phase spent anything, so only it gets a row — a
		// zero-length level for phase 1 would claim time no process took
		expect(phaseRows({ commandRun })).toStrictEqual([{ level: ActivityLevelKind.Pass, label: 'phase 2/2: phase2.md', outcome: 'passed' }]);
	});

	test("a phase that ends short closes its pass level with that phase's own outcome", async () => {
		const failing = await setupFailingPhasedActivity();

		const result = await runPhasesPipeline({
			cwd: failing.dir,
			driver: failing.driver,
			config: failing.config,
			overviewPath: failing.overviewPath,
			skipRefactor: true,
			level: failing.level,
		});
		const commandRun = await readCommandRun(failing);

		expect(result.ok).toBe(false);
		expectDefined(commandRun);
		// each row carries the outcome of the phase it drew, so a stopped
		// sequence reads as one phase passed and the next one failed rather than
		// as a sequence that passed throughout
		expect(phaseRows({ commandRun })).toStrictEqual([
			{ level: ActivityLevelKind.Pass, label: 'phase 1/2: phase1.md', outcome: 'passed' },
			{ level: ActivityLevelKind.Pass, label: 'phase 2/2: phase2.md', outcome: 'failed' },
		]);
	});
});
