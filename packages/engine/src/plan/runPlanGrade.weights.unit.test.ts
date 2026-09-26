import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { gradeMemoryPath } from '#src/plan/common/utils/gradeMemoryPath.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// Which plan files earn the reader fan-out: the weight each is given, where it
// is recorded, and that a repository which never declared the key sees the
// fan-out it always had.

/** The clean plan with an acceptance-test ledger, so a contract repository's lint is clean too. */
const contractBody = ({ mirror }: { mirror: boolean }) => {
	const body = cleanPlanBody({ title: 'Graded Plan' });

	return `${mirror ? body : body.replace('## Patterns to Mirror\n\n- `src/index.js` — mirror its single-export shape.\n', '')}
## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
| newThing is re-exported | \`src/newThing.unit.test.ts\` | re-exports newThing | test |
`;
};

/** A contract repository holding one plan, weighed light or heavy by whether it names a pattern to mirror. */
const setupWeighed = ({
	mirror,
	contract = true,
	thresholds,
}: {
	mirror: boolean;
	contract?: boolean;
	thresholds?: { 'created-files'?: number; packages?: number };
}) => {
	const cwd = setupConsumerRepo({ config: contract ? { plan: { contract: true, 'weight-thresholds': thresholds } } : undefined });
	const invocations: DriverInvocation[] = [];

	writePlanDeliverable({ cwd, name: 'weighed', body: contractBody({ mirror }) });

	return { cwd, name: 'weighed', invocations, driver: createGapCheckDriver({ invocations }) };
};

test('plan grade: a plan file that weighs light is graded by the mechanical checks alone, with no agent spawned', async () => {
	const { cwd, name, driver, invocations } = setupWeighed({ mirror: true });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect(invocations).toStrictEqual([]);
	expect(result.grade.phasesLight).toStrictEqual(['plan.md']);
	expect(result.grade.phasesChecked).toStrictEqual([]);
	// no reader ran, so the coverage line must not claim three lenses did
	expect(result.grade.lenses).toStrictEqual([]);
	expect(result.grade.weights).toStrictEqual([{ phase: 'plan.md', weight: 'light', reasons: [] }]);
	expect(result.grade.passed).toBe(true);
});

test('plan grade: a plan file with no pattern to mirror weighs heavy and gets the whole reader fan-out', async () => {
	const { cwd, name, driver, invocations } = setupWeighed({ mirror: false });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect(result.grade.weights).toStrictEqual([{ phase: 'plan.md', weight: 'heavy', reasons: ['names no pattern to mirror'] }]);
	expect(result.grade.phasesChecked).toStrictEqual(['plan.md']);
	expect(result.grade.phasesLight).toStrictEqual([]);
	expect(invocations.length).toBeGreaterThan(0);
});

test('plan grade: with the key never declared, nothing is weighed and every plan file is read exactly as before', async () => {
	const { cwd, name, driver, invocations } = setupWeighed({ mirror: true, contract: false });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect(result.grade.weights).toStrictEqual([]);
	expect(result.grade.phasesChecked).toStrictEqual(['plan.md']);
	expect(invocations.length).toBeGreaterThan(0);
});

test('plan grade: a declared threshold replaces the default, so a plan the defaults would let pass weighs heavy', async () => {
	const { cwd, name, driver, invocations } = setupWeighed({ mirror: true, thresholds: { 'created-files': 0 } });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// the same plan weighs light under the default of three created files
	expect(result.grade.weights).toStrictEqual([{ phase: 'plan.md', weight: 'heavy', reasons: ['creates 1 source files, above 0'] }]);
	expect(result.grade.phasesChecked).toStrictEqual(['plan.md']);
	expect(invocations.length).toBeGreaterThan(0);
});

test('plan grade: a light plan file is covered at its current text and does not block approval', async () => {
	const { cwd, name, driver, invocations } = setupWeighed({ mirror: true });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');

	const memoryFile = await gradeMemoryPath({ cwd, name });
	const memory = GradeMemory.parse(JSON.parse(readFileSync(memoryFile, 'utf8')));
	const entries = memory.coverage.readers.map(({ file, lens }) => `${file}:${lens}`).sort();

	// nobody read it, and yet every brief holds an entry for it at its current text
	expect(invocations).toStrictEqual([]);
	expect(entries).toStrictEqual(['plan.md:decisions', 'plan.md:surface', 'plan.md:wiring']);
	expect(result.grade.covered).toStrictEqual(['plan.md']);
	expect(result.grade.complete).toBe(true);
	expect(result.grade.incompleteReason).toBeUndefined();
	expect(result.grade.passed).toBe(true);
});
