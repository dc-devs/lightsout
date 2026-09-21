import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { buildActivityTree, readActivityMarks } from '#src/activity/index.ts';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planCommand, planGradeCommand } from '#src/cli/plan/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// What `plan grade` leaves in the plan folder's activity record: its own command
// run under the plan level, the pass its spawns hang from, and an end mark whose
// outcome agrees with the exit code the same run returns.

/**
 * A real consumer repo holding one clean single-file plan, graded through the
 * real command. `git` is off because the record's location is the plan folder
 * rather than anything git answers, and `drafted` off is the run whose
 * deliverable never resolves.
 */
const setupGradedRecord = ({ drafted = true, driver = createGapCheckDriver() }: { drafted?: boolean; driver?: Driver } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });

	if (drafted) {
		writePlanDeliverable({ cwd, name: 'demo', body: cleanPlanBody() });
	}

	return { cwd, name: 'demo', driver, planDir: join(cwd, '.lightsout', 'tickets', 'demo', 'plans'), ...captured };
};

/** The folded record the plan folder holds, as a report reader would see it. */
const recordedTree = async ({ planDir }: { planDir: string }) => buildActivityTree({ plan: 'demo', marks: await readActivityMarks({ dir: planDir }) });

// The nameless `plan grade` refusal, driven through the real argument path.
// `planGradeCommand` takes a resolved name, so the only way to state "invoked
// without --name" is the command line that never reaches it.
const setupNamelessGrade = () => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const rest = ['grade'];

	return { context: { flags: parseFlags({ args: rest }), rest, cwd }, cwd, ...captured };
};

describe('planGradeCommand', () => {
	test('a graded plan records one command run under the plan level, both ended passed', async () => {
		const { cwd, driver, name, planDir, exitCodes } = setupGradedRecord();

		await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

		const report = await recordedTree({ planDir });

		// the command run hangs under the plan level rather than standing on its
		// own: a command run with no plan above it has nothing to fold into
		expect(report.roots).toEqual([
			expect.objectContaining({
				level: 'plan',
				label: 'demo',
				startedAt: expect.any(String),
				endedAt: expect.any(String),
				outcome: 'passed',
				children: [
					expect.objectContaining({
						level: 'command-run',
						label: 'plan grade',
						startedAt: expect.any(String),
						endedAt: expect.any(String),
						outcome: 'passed',
					}),
				],
			}),
		]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('the grade pass, and every reader it spawned, hangs under the command run', async () => {
		const { cwd, driver, name, planDir, exitCodes } = setupGradedRecord();

		await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

		const report = await recordedTree({ planDir });
		const commandRun = report.roots[0]?.children[0];

		expectDefined(commandRun);

		const pass = commandRun.children[0];

		expectDefined(pass);

		// the command run holds the pass and nothing else — a reader that attached
		// to the command run itself would say the pass cost nothing
		expect(commandRun.children.map(({ level, label }) => ({ level, label }))).toStrictEqual([{ level: 'pass', label: 'full pass' }]);
		// one step per reader, named for the plan file and the brief it read with,
		// sorted because the fan-out opens them concurrently
		expect(pass.children.map(({ level }) => level)).toStrictEqual(['step', 'step', 'step']);
		expect(pass.children.map(({ label }) => label).sort()).toStrictEqual(['grade-plan-decisions', 'grade-plan-surface', 'grade-plan-wiring']);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a rate-limited grade ends its command run on the rate-limit wall', async () => {
		const rateLimited: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };
		const { cwd, driver, name, planDir, exitCodes } = setupGradedRecord({ driver: rateLimited });

		await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

		const report = await recordedTree({ planDir });
		const commandRun = report.roots[0]?.children[0];

		expectDefined(commandRun);

		// the end mark carries the state the exit code reports, so a report and a
		// script never disagree about how this run finished
		expect(commandRun).toEqual(expect.objectContaining({ level: 'command-run', endedAt: expect.any(String), outcome: 'paused-rate-limit' }));
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a grade whose deliverable never resolves records a failed command run, and the record never speaks over the error', async () => {
		const { cwd, driver, name, planDir, errors, exitCodes } = setupGradedRecord({ drafted: false });

		await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

		const report = await recordedTree({ planDir });
		const commandRun = report.roots[0]?.children[0];

		expectDefined(commandRun);

		// nothing was graded, so the command run is a leaf ended failed
		expect(commandRun).toEqual(expect.objectContaining({ level: 'command-run', label: 'plan grade', outcome: 'failed', children: [] }));
		// and the one thing on stderr is what the human has to act on — a record
		// that complained here would bury it
		expect(errors[0] ?? '').toMatch(/no plan found for 'demo'/);
		expect(errors.filter((line) => line.includes('activity record'))).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a subcommand that refuses before doing work records nothing', async () => {
		const { context, cwd, errors, exitCodes } = setupNamelessGrade();

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		const written = readdirSync(cwd, { recursive: true, encoding: 'utf8' });

		// a run that spent nothing records nothing: an activity record opened here
		// would put a command run in the report for work that never happened
		expect(written.filter((entry) => entry.endsWith('activity.jsonl'))).toStrictEqual([]);
		expect(errors[0] ?? '').toMatch(/usage:/);
		expect(exitCodes).toStrictEqual([1]);
	});
});
