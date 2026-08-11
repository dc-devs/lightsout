import { describe, expect, test } from '@jest/globals';
import { GradeReport } from '@/contracts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const finding = {
		check: 'no-placeholders',
		issue: 'the Verification section still reads TODO',
		location: 'Verification, line 88',
		fix: 'replace the TODO with the commands that must pass',
	};
	const gap = {
		area: 'standards-conflict',
		gap: 'the plan mandates a barrel under common/, which folder-structure.md forbids',
		decision: 'choose the barrel or the standard',
		options: ['drop the barrel', 'amend the standard'],
	};
	const report = {
		planName: 'packages-to-src',
		grade: 'below-A',
		structural: [finding],
		gaps: [gap],
		passed: false,
		gradedAt: '2026-08-04T00:00:00.000Z',
		...overrides,
	};

	return { report, finding, gap };
};

describe('GradeReport', () => {
	test('a persisted grade.json parses with both halves of the evidence intact', () => {
		const { report } = setupReport();

		const parsed = GradeReport.parse(report);

		expect(parsed).toStrictEqual({
			planName: 'packages-to-src',
			grade: 'below-A',
			structural: [
				{
					check: 'no-placeholders',
					issue: 'the Verification section still reads TODO',
					location: 'Verification, line 88',
					fix: 'replace the TODO with the commands that must pass',
				},
			],
			gaps: [
				{
					area: 'standards-conflict',
					gap: 'the plan mandates a barrel under common/, which folder-structure.md forbids',
					decision: 'choose the barrel or the standard',
					options: ['drop the barrel', 'amend the standard'],
				},
			],
			passed: false,
			gradedAt: '2026-08-04T00:00:00.000Z',
		});
	});

	test('structural and gaps default to empty — a clean pass carries no evidence', () => {
		const parsed = GradeReport.parse({ planName: 'packages-to-src', grade: 'A', passed: true, gradedAt: '2026-08-04T00:00:00.000Z' });

		// the skill reads both arrays off every grade report without guarding for
		// absence
		expect(parsed.structural).toStrictEqual([]);
		expect(parsed.gaps).toStrictEqual([]);
	});

	test('grade accepts the bar and everything short of it', () => {
		for (const grade of ['A', 'below-A']) {
			const { report } = setupReport({ grade });

			const parsed = GradeReport.parse(report);

			// ${grade} is one of the two verdicts a plan is graded to
			expect(parsed.grade).toBe(grade);
		}
	});

	test('rejects a grade outside the two-verdict set', () => {
		for (const grade of ['B', 'below-a', 'BelowA', 'A+']) {
			const { report } = setupReport({ grade });

			const result = GradeReport.safeParse(report);

			// ${grade} is not a grade the engine writes — the enum carries the PlanGrade
			// values, not its keys or a wider scale
			expect(result.success).toBe(false);
		}
	});

	test('rejects a report missing any required field', () => {
		for (const field of ['planName', 'grade', 'passed', 'gradedAt']) {
			const { report } = setupReport({ [field]: undefined });

			const result = GradeReport.safeParse(report);

			// ${field} is required — planName keys the report to its plan workspace, grade
			// and passed are the verdict, and gradedAt tells the human whether the grade
			// predates their latest edit
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-boolean passed rather than coercing it to truthiness', () => {
		for (const passed of ['false', 0, 'true']) {
			const { report } = setupReport({ passed });

			const result = GradeReport.safeParse(report);

			// passed is the typed verdict the skill branches on instead of re-implementing
			// a check, so a truthy string must never reach it
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-string gradedAt rather than coercing a timestamp', () => {
		const { report } = setupReport({ gradedAt: 1786000000000 });

		const result = GradeReport.safeParse(report);

		// the field is the ISO string runPlanGrade writes, so grade.json round-trips
		// unchanged
		expect(result.success).toBe(false);
	});

	test('nested gap defaults are applied when grade.json is read back', () => {
		const { report } = setupReport({
			gaps: [{ area: 'insufficient-detail', gap: 'the move map names no target for tests/helpers', decision: 'name the target directory' }],
		});

		const parsed = GradeReport.parse(report);

		// the gap default survives the nesting — a gap written without options reads
		// back with an empty list
		expect(parsed.gaps[0]).toStrictEqual({
			area: 'insufficient-detail',
			gap: 'the move map names no target for tests/helpers',
			decision: 'name the target directory',
			options: [],
		});
	});

	test('one malformed structural finding rejects the whole report', () => {
		const { report } = setupReport({
			structural: [{ check: 'path-exists', issue: 'this entry names no location', fix: 'add one' }],
		});

		const result = GradeReport.safeParse(report);

		// a partly readable grade.json is refused at the read boundary rather than
		// printing a defect the human cannot locate
		expect(result.success).toBe(false);
	});

	test('rejects a structural or gaps value that is not an array', () => {
		const { report, finding, gap } = setupReport();

		for (const overrides of [{ structural: finding }, { gaps: gap }]) {
			const result = GradeReport.safeParse({ ...report, ...overrides });

			// a single finding or gap object in place of its list is a malformed report
			expect(result.success).toBe(false);
		}
	});

	test('extra keys are stripped', () => {
		const { report } = setupReport({ gradedBy: 'claude-code' });

		const parsed = GradeReport.parse(report);

		// grade.json holds the six declared fields, whatever else a hand edit added
		expect('gradedBy' in parsed).toBe(false);
	});
});
