import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { GapArea } from '@/contracts';
import type { Driver } from '@/drivers';
import { planGradeCommand } from '@/cli/plan/planGradeCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { cleanPlanBody } from '@tests/helpers/cleanPlanBody';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { writePlanDeliverable } from '@tests/helpers/writePlanDeliverable';

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** A gap-check stub returning a fixed gap set for every plan file it is handed. */
const gapDriver = ({ gaps }: { gaps: unknown[] }): Driver => ({
	name: 'stub',
	invoke: async () => ({ text: JSON.stringify({ gaps }), exitCode: 0 }),
});

// A real consumer repo with a real committed deliverable: the structural half of
// the grade is the deterministic lint, and only the gap half is stubbed.
const setupGrade = ({ t, body }: { t: TestContext; body?: string }) => {
	const captured = captureCommandOutput({ t });
	const cwd = setupConsumerRepo({ git: false });
	const plansDir = body === undefined ? join(cwd, '.claude', 'plans') : writePlanDeliverable({ cwd, name: 'demo', body });

	return { cwd, plansDir, name: 'demo', ...captured };
};

test('planGradeCommand: a clean plan with no gaps grades A, reports both counts and the grade path, and exits 0', async (t) => {
	const { cwd, plansDir, name, logged, errors, exitCodes } = setupGrade({ t, body: cleanPlanBody() });

	await assert.rejects(
		planGradeCommand({ cwd, driver: gapDriver({ gaps: [] }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.match(printed[0] ?? '', /^\nplan grade demo — A \(graded \d{4}-\d\d-\d\dT/);
	assert.equal(printed[1], '  structural: 0 · gaps: 0');
	assert.equal(printed[2], `\ngrade: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade.json')}`);
	assert.equal(printed.length, 3, `an A grade prints no finding lines, got: ${JSON.stringify(printed)}`);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('planGradeCommand: a gap drops the grade below A and prints the decision with the options to choose among', async (t) => {
	const { cwd, plansDir, name, logged, exitCodes } = setupGrade({ t, body: cleanPlanBody() });
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: ['sqlite', 'postgres'] }];

	await assert.rejects(
		planGradeCommand({ cwd, driver: gapDriver({ gaps }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.match(printed[0] ?? '', /^\nplan grade demo — below-A \(graded \d{4}-\d\d-\d\dT/);
	assert.equal(printed[1], '  structural: 0 · gaps: 1');
	assert.equal(printed[2], '? [omitted-decision] no storage choice');
	assert.equal(printed[3], '   decide: pick a store — options: sqlite / postgres');
	assert.deepEqual(exitCodes, [0]);
});

test('planGradeCommand: a structurally dirty plan prints the lint finding, and an optionless gap prints the decision alone', async (t) => {
	const { cwd, plansDir, name, logged, exitCodes } = setupGrade({
		t,
		body: cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting'),
	});
	const gaps = [{ area: GapArea.InsufficientDetail, gap: 'no error handling named', decision: 'say what a failure does', options: [] }];

	await assert.rejects(
		planGradeCommand({ cwd, driver: gapDriver({ gaps }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.match(printed[0] ?? '', /^\nplan grade demo — below-A /);
	assert.equal(printed[1], '  structural: 1 · gaps: 1');
	assert.match(printed[2] ?? '', /^⚠ \[no-placeholders\] demo\.md:\d+ — unresolved placeholder 'TBD' present$/);
	assert.match(printed[3] ?? '', /^ {3}fix: resolve 'TBD'/);
	assert.equal(printed[4], '? [insufficient-detail] no error handling named');
	assert.equal(printed[5], '   decide: say what a failure does');
	assert.deepEqual(exitCodes, [0]);
});

test('planGradeCommand: an unresolvable deliverable reports the error on stderr and exits 1', async (t) => {
	const { cwd, plansDir, name, logged, errors, exitCodes } = setupGrade({ t });

	await assert.rejects(
		planGradeCommand({ cwd, driver: gapDriver({ gaps: [] }), name, plansDir, standards: undefined, config: undefined }),
		/process\.exit/,
	);

	assert.deepEqual(printedLines({ logged }), []);
	assert.match(errors[0] ?? '', /no plan found for 'demo'/);
	assert.deepEqual(exitCodes, [1]);
});
