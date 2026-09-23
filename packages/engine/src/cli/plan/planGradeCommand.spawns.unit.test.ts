import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { planGradeCommand } from '#src/cli/plan/index.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { Effort, Permissions } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// What a grade hands the harness, and what a second pass over untouched inputs
// hands it instead — nothing. Every act here states what the harness was given
// rather than what the command printed, which is why they sit apart from the
// printing acts in `planGradeCommand.unit.test.ts`.

// A clean single-file plan graded with every harness invocation collected, so an
// act can state what the harness was handed rather than what the command
// printed. `git` commits the repo, which is what lets a second pass measure the
// very inputs the first one recorded — a recorded full review is reusable only
// when the tree under it has not moved.
const setupRecordedGrade = ({ config, git = false }: { config?: LightsoutConfig; git?: boolean } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git });
	const invocations: DriverInvocation[] = [];

	writePlanDeliverable({ cwd, name: 'demo', body: cleanPlanBody() });

	return { cwd, name: 'demo', config, driver: createGapCheckDriver({ invocations }), invocations, ...captured };
};

test("planGradeCommand: the config's model, effort and permissions are handed to the harness with the plan's own repo as the working directory", async () => {
	const { cwd, name, config, driver, invocations } = setupRecordedGrade({
		config: {
			model: 'claude-opus-5',
			effort: Effort.High,
			permissions: Permissions.FullAccess,
			gates: { check: 'true', test: 'true', 'test-coverage': false },
		},
	});

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config })).rejects.toThrow(/process\.exit/);

	expect(invocations[0]).toEqual(expect.objectContaining({ cwd, model: 'claude-opus-5', effort: 'high', permissions: 'full-access' }));
	// every checker in the fan-out, not merely the first
	expect(invocations.length).toBe(3);
});

test('planGradeCommand: with no config the harness call carries no model, effort or permissions — nothing is invented for the harness to honor', async () => {
	const { cwd, name, config, driver, invocations } = setupRecordedGrade();

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config })).rejects.toThrow(/process\.exit/);

	expect(invocations[0]).toEqual(expect.objectContaining({ model: undefined, effort: undefined, permissions: undefined }));
});

test('plan grade prints the scope, the reuse line and the memory path', async () => {
	const { cwd, driver, name, invocations, logged, exitCodes } = setupRecordedGrade({ git: true });
	const planDir = join(cwd, '.lightsout', 'work-orders', 'demo', 'plans');

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	// what the first pass left behind, read before the second pass runs, so
	// "nothing was re-run" is a comparison rather than a claim
	const firstPassLines = logged.length;
	const firstPassSpawns = invocations.length;
	const gradeAfterFirstPass = readFileSync(join(planDir, 'grade.json'), 'utf8');
	const historyAfterFirstPass = readFileSync(join(planDir, 'grade-history.jsonl'), 'utf8');
	const firstReport = JSON.parse(gradeAfterFirstPass) as { scope: string; scopeReason: string };

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printedByFirstPass = logged.slice(0, firstPassLines);
	const printedByReuse = logged.slice(firstPassLines);
	const memoryPath = join(planDir, 'grade-memory.json');
	// the one line that carries the reason the pass reached as far as it did
	const scopeLine = printedByFirstPass.find((line) => line.includes(firstReport.scopeReason)) ?? '';

	// a pass over every plan file, and a line saying which rule chose that far —
	// a history line nobody can explain is not a reason
	expect(firstReport.scope).toBe('full');
	expect(firstReport.scopeReason).toEqual(expect.stringMatching(/\S/));
	expect(scopeLine).toContain('full');
	// the memory file is named beside the grade and the history, on both passes,
	// because it is the third file a human opens after a grade
	expect(printedByFirstPass).toContainEqual(expect.stringContaining(memoryPath));
	expect(printedByReuse).toContainEqual(expect.stringContaining(memoryPath));
	// the recorded full review still covers these inputs, so the second pass
	// spawned nothing, appended nothing, and left the verdict where it was
	expect(firstPassSpawns).toBeGreaterThan(0);
	expect(invocations.length).toBe(firstPassSpawns);
	expect(readFileSync(join(planDir, 'grade-history.jsonl'), 'utf8')).toBe(historyAfterFirstPass);
	expect(readFileSync(join(planDir, 'grade.json'), 'utf8')).toBe(gradeAfterFirstPass);
	// and the terminal says so, naming the file to delete to force a new baseline
	expect(printedByReuse).toContainEqual(expect.stringMatching(/full review/i));
	expect(printedByReuse).toContainEqual(expect.stringContaining('grade-memory.json'));
	expect(exitCodes).toStrictEqual([0, 0]);
});
