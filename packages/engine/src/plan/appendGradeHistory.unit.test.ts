import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { GapCheckLens, GradeReport, PlanGrade } from '#src/contracts/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** One finished pass, carrying only the fields a case turns on. */
const reportOf = ({
	grade = PlanGrade.A,
	gradedAt,
	complete = true,
	incompleteReason,
}: {
	grade?: PlanGrade;
	gradedAt: string;
	complete?: boolean;
	incompleteReason?: string;
}): GradeReport => ({
	planName: 'graded',
	grade,
	structural: [],
	gaps: [],
	phasesChecked: ['plan.md'],
	lenses: [GapCheckLens.Surface, GapCheckLens.Wiring, GapCheckLens.Decisions],
	complete,
	incompleteReason,
	passed: grade === PlanGrade.A,
	gradedAt,
});

/** The ledger as a reader gets it back: every line parsed against the report contract. */
const readHistory = ({ cwd, name }: { cwd: string; name: string }) => readJsonlRecords({ path: gradeHistoryPath({ cwd, name }), schema: GradeReport });

test('appendGradeHistory: one pass appends one readable line', async () => {
	const cwd = setupConsumerRepo();

	await appendGradeHistory({ cwd, name: 'graded', report: reportOf({ gradedAt: '2026-01-01T00:00:00.000Z' }) });

	const records = await readHistory({ cwd, name: 'graded' });

	expect(records.length).toBe(1);
	expect(records[0]).toEqual(expect.objectContaining({ planName: 'graded', grade: 'A', gradedAt: '2026-01-01T00:00:00.000Z' }));
});

test('appendGradeHistory: a second pass does not overwrite the first', async () => {
	const cwd = setupConsumerRepo();

	await appendGradeHistory({ cwd, name: 'graded', report: reportOf({ grade: PlanGrade.BelowA, gradedAt: '2026-01-01T00:00:00.000Z' }) });
	await appendGradeHistory({ cwd, name: 'graded', report: reportOf({ gradedAt: '2026-01-02T00:00:00.000Z' }) });

	const records = await readHistory({ cwd, name: 'graded' });

	// the whole point of a ledger: how the plan got to its verdict, in the order
	// the passes ran
	expect(records.map(({ grade, gradedAt }) => `${grade}@${gradedAt}`)).toStrictEqual(['below-A@2026-01-01T00:00:00.000Z', 'A@2026-01-02T00:00:00.000Z']);
	expect(records[0]?.passed).toBe(false);
});

test('appendGradeHistory: a pass that did not finish is recorded too', async () => {
	const cwd = setupConsumerRepo();
	const report = reportOf({
		grade: PlanGrade.BelowA,
		gradedAt: '2026-01-03T00:00:00.000Z',
		complete: false,
		incompleteReason: 'plan.md/surface: rate limited or overloaded',
	});

	await appendGradeHistory({ cwd, name: 'graded', report });

	const records = await readHistory({ cwd, name: 'graded' });

	// an unfinished pass sits in the ledger beside the finished ones, saying on its
	// own face that it did not finish
	expect(records[0]?.complete).toBe(false);
	expect(records[0]?.incompleteReason).toBe('plan.md/surface: rate limited or overloaded');
});

test('appendGradeHistory: the ledger is created when the plan folder is not there yet', async () => {
	const cwd = setupConsumerRepo();

	await appendGradeHistory({ cwd, name: 'never-graded', report: reportOf({ gradedAt: '2026-01-04T00:00:00.000Z' }) });

	expect((await readHistory({ cwd, name: 'never-graded' })).length).toBe(1);
});

test('appendGradeHistory: the ledger is written into the plan folder, named grade-history.jsonl', async () => {
	const cwd = setupConsumerRepo();

	await appendGradeHistory({ cwd, name: 'graded', report: reportOf({ gradedAt: '2026-01-05T00:00:00.000Z' }) });

	// the spelled-out path rather than the helper's own answer: a ledger written
	// anywhere but beside grade.json is one no reader of the plan folder finds
	const written = readFileSync(join(cwd, '.lightsout', 'plans', 'graded', 'grade-history.jsonl'), 'utf8');

	// the trailing newline is what makes the next pass its own line rather than a
	// second report glued onto the end of the first
	expect(written.endsWith('\n')).toBe(true);
	expect(GradeReport.parse(JSON.parse(written.trim()))).toEqual(expect.objectContaining({ planName: 'graded', gradedAt: '2026-01-05T00:00:00.000Z' }));
});

test('appendGradeHistory: a report its own contract rejects is never written', async () => {
	const cwd = setupConsumerRepo();
	const malformed = { ...reportOf({ gradedAt: '2026-01-06T00:00:00.000Z' }), grade: 'A+' } as unknown as GradeReport;

	await expect(appendGradeHistory({ cwd, name: 'graded', report: malformed })).rejects.toThrow();

	// a line the reader would silently skip is worse than no line at all: the
	// pass would then read as one that never ran
	expect((await readHistory({ cwd, name: 'graded' })).length).toBe(0);
});
