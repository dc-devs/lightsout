import { join } from 'node:path';
import { expect, test } from '@jest/globals';
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
const setupGrade = ({ body }: { body?: string } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const plansDir = body === undefined ? join(cwd, '.claude', 'plans') : writePlanDeliverable({ cwd, name: 'demo', body });

	return { cwd, plansDir, name: 'demo', ...captured };
};

test('planGradeCommand: a clean plan with no gaps grades A, reports both counts and the grade path, and exits 0', async () => {
	const { cwd, plansDir, name, logged, errors, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps: [] }), name, plansDir, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \d{4}-\d\d-\d\dT/);
	expect(printed[1]).toBe('  structural: 0 · gaps: 0');
	expect(printed[2]).toBe(`\ngrade: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade.json')}`);
	// an A grade prints no finding lines, got: ${JSON.stringify(printed)}
	expect(printed.length).toBe(3);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a gap drops the grade below A and prints the decision with the options to choose among', async () => {
	const { cwd, plansDir, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody() });
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: ['sqlite', 'postgres'] }];

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps }), name, plansDir, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A \(graded \d{4}-\d\d-\d\dT/);
	expect(printed[1]).toBe('  structural: 0 · gaps: 1');
	expect(printed[2]).toBe('? [omitted-decision] no storage choice');
	expect(printed[3]).toBe('   decide: pick a store — options: sqlite / postgres');
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a structurally dirty plan prints the lint finding, and an optionless gap prints the decision alone', async () => {
	const { cwd, plansDir, name, logged, exitCodes } = setupGrade({
		
		body: cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting'),
	});
	const gaps = [{ area: GapArea.InsufficientDetail, gap: 'no error handling named', decision: 'say what a failure does', options: [] }];

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps }), name, plansDir, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A /);
	expect(printed[1]).toBe('  structural: 1 · gaps: 1');
	expect(printed[2] ?? '').toMatch(/^⚠ \[no-placeholders\] demo\.md:\d+ — unresolved placeholder 'TBD' present$/);
	expect(printed[3] ?? '').toMatch(/^ {3}fix: resolve 'TBD'/);
	expect(printed[4]).toBe('? [insufficient-detail] no error handling named');
	expect(printed[5]).toBe('   decide: say what a failure does');
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: an unresolvable deliverable reports the error on stderr and exits 1', async () => {
	const { cwd, plansDir, name, logged, errors, exitCodes } = setupGrade();

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps: [] }), name, plansDir, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	expect(printedLines({ logged })).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/no plan found for 'demo'/);
	expect(exitCodes).toStrictEqual([1]);
});
