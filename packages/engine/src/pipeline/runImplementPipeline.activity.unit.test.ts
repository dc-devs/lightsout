import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { type ActivityLevel, buildActivityTree, createActivityRecorder, readActivityMarks } from '#src/activity/index.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { ActivityLevelKind, type ActivityNode, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { createOffContractDriver } from '#tests/helpers/createOffContractDriver.ts';
import { createRateLimitedDriver } from '#tests/helpers/createRateLimitedDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { report } from '#tests/helpers/report.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// What an implement run writes into the activity record it was handed: one step
// level per agent call, named for the call's own step, and nothing at all for
// the steps that spawn no agent.

/** The plan folder this run's record is written into, and the command-run level the run hangs its steps from. */
const setupRecordedRun = () => {
	const recordDir = mkdtempSync(join(tmpdir(), 'lightsout-activity-'));
	const plan = createActivityRecorder({ dir: recordDir, level: ActivityLevelKind.Plan, label: 'plan-under-test' });
	const level = plan.open({ level: ActivityLevelKind.CommandRun, label: 'implement' });

	return { recordDir, level };
};

/** Close the command run, let every mark reach disk, and answer the folded command-run level. */
const readCommandRun = async ({ level, recordDir }: { level: ActivityLevel; recordDir: string }): Promise<ActivityNode | undefined> => {
	level.close({ outcome: RunStatus.Passed });
	await level.settled();

	const tree = buildActivityTree({ plan: 'plan-under-test', marks: await readActivityMarks({ dir: recordDir }) });

	return tree.roots.flatMap((root) => root.children).find((child) => child.level === ActivityLevelKind.CommandRun);
};

/**
 * A run that reaches the end: the executor lands one module (and the caller
 * wiring it in, so the writers fan out over two subjects), each writer plants a
 * test file beside its subject, and the test-side change that makes is reviewed
 * at the checkpoint after the writers — never at the one before them.
 */
const setupFullRun = () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				const role = roleOf(prompt);

				if (role === 'write-tests') {
					const subject = /- (\S+)/.exec(prompt)?.[1] ?? 'src/unknown.js';
					const testFile = subject.replace('.js', '.unit.test.js');

					writeFileSync(join(dir, testFile), '// stub test\n');

					return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
				}

				if (role === 'implement') {
					writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

					return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, ...setupRecordedRun() };
};

/**
 * A run whose test gate stays red until the supervisor is consulted: the
 * executor drops a file the gate trips over, the two cheap fix retries leave it
 * there, and the supervisor escalates rather than sending the run round again.
 */
const setupSupervisorRun = () => {
	const dir = setupConsumerRepo({ scripts: { test: 'test ! -f BROKEN' } });
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				const role = roleOf(prompt);

				if (role === 'supervisor') {
					return { text: verdict({ decision: 'escalate', diagnosis: 'the gate trips on a file the fixes left behind' }), exitCode: 0 };
				}

				if (role === 'implement') {
					writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
					writeFileSync(join(dir, 'BROKEN'), 'x');

					return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, ...setupRecordedRun() };
};

test('each agent call opens its own step level and a step that spawns nothing opens none', async () => {
	const { dir, driver, level, recordDir } = setupFullRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md', skipRefactor: true, level });

	const commandRun = await readCommandRun({ level, recordDir });

	expect(result.ok).toBe(true);
	expectDefined(commandRun);
	// One row per agent call and not one more: clean-slate, the empty ledger
	// step, both formatter passes and both green verify gates spawn nothing, so
	// they are already inside the rows above them. The two writers ran in
	// parallel under one step name and are two sibling rows, because they were
	// two requests.
	expect(commandRun.children.map(({ level: kind, label }) => ({ kind, label }))).toStrictEqual([
		{ kind: ActivityLevelKind.Step, label: 'implement' },
		{ kind: ActivityLevelKind.Step, label: 'write-tests' },
		{ kind: ActivityLevelKind.Step, label: 'write-tests' },
		{ kind: ActivityLevelKind.Step, label: 'verify-tests-test-review' },
	]);
	// each call's harness process is on the call's own row
	expect(commandRun.children.map(({ processes }) => processes.length)).toStrictEqual([1, 1, 1, 1]);
	// and none of them landed on the run's own level
	expect(commandRun.processes).toStrictEqual([]);
});

test('the supervisor consult is recorded as its own step level', async () => {
	const { dir, driver, level, recordDir } = setupSupervisorRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md', skipRefactor: true, level });

	const commandRun = await readCommandRun({ level, recordDir });

	expect(result.manifest.status).toBe('escalated');
	expectDefined(commandRun);
	// the two cheap fix retries are rows of the checkpoint they repaired; the
	// consult is a row of its own, named the way its transcript and its usage row
	// already name it
	expect(commandRun.children.map(({ label }) => label)).toStrictEqual(['implement', 'verify-implement', 'verify-implement', 'verify-implement-supervisor']);

	const consult = commandRun.children[3];

	expect(consult.outcome).toBe('passed');
	// the consult's own harness process, on the consult's own row rather than the
	// verify step's
	expect(consult.processes.length).toBe(1);
	expect(commandRun.processes).toStrictEqual([]);
});

test('the test-change review is recorded as its own step level', async () => {
	const { dir, driver, level, recordDir } = setupFullRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md', skipRefactor: true, level });

	const commandRun = await readCommandRun({ level, recordDir });

	expect(result.ok).toBe(true);
	expectDefined(commandRun);

	const review = commandRun.children.find(({ label }) => label === 'verify-tests-test-review');

	expectDefined(review);
	expect(review.outcome).toBe('passed');
	// the reviewer's process is the reviewer's own, not the writers' and not the
	// checkpoint's
	expect(review.processes.length).toBe(1);
	expect(commandRun.children.filter(({ label }) => label === 'write-tests').map(({ processes }) => processes.length)).toStrictEqual([1, 1]);
	// nothing test-side had changed at the checkpoint before the writers ran, so
	// that checkpoint opened no review row at all
	expect(commandRun.children.some(({ label }) => label === 'verify-implement-test-review')).toBe(false);
});

test('a rate-limited agent call closes its step level as paused rather than failed', async () => {
	const parked = setupRecordedRun();
	const failing = setupRecordedRun();
	const parkedDir = setupConsumerRepo();
	const failingDir = setupConsumerRepo();

	const parkedResult = await runImplementPipeline({
		cwd: parkedDir,
		driver: createRateLimitedDriver(),
		config: await readConfig({ cwd: parkedDir }),
		planPath: 'plan.md',
		level: parked.level,
	});
	const failingResult = await runImplementPipeline({
		cwd: failingDir,
		driver: createOffContractDriver({ text: 'prose with no report in it' }),
		config: await readConfig({ cwd: failingDir }),
		planPath: 'plan.md',
		level: failing.level,
	});

	const parkedRun = await readCommandRun({ level: parked.level, recordDir: parked.recordDir });
	const failingRun = await readCommandRun({ level: failing.level, recordDir: failing.recordDir });

	expect(parkedResult.manifest.status).toBe('paused-rate-limit');
	expectDefined(parkedRun);
	// the wall is a resumable state the run can be re-entered from — a row closed
	// as failed would send a human to diagnose a run that only has to be re-run
	expect(parkedRun.children.map(({ label, outcome }) => ({ label, outcome }))).toStrictEqual([{ label: 'implement', outcome: 'paused-rate-limit' }]);

	expect(failingResult.manifest.status).toBe('failed');
	expectDefined(failingRun);
	expect(failingRun.children.map(({ label, outcome }) => ({ label, outcome }))).toStrictEqual([{ label: 'implement', outcome: 'failed' }]);
});
