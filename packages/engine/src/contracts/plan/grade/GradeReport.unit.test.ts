import { describe, expect, test } from '@jest/globals';
import { GradeReport } from '#src/contracts/index.ts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const finding = {
		check: 'no-placeholders',
		severity: 'blocking',
		phase: 'plan.md',
		issue: 'the Verification section still reads TODO',
		location: 'Verification, line 88',
		fix: 'replace the TODO with the commands that must pass',
	};
	const gap = {
		area: 'standards-conflict',
		gap: 'the plan mandates a barrel under common/, which folder-structure.md forbids',
		decision: 'choose the barrel or the standard',
		options: ['drop the barrel', 'amend the standard'],
		phase: 'phase2-cross-phase-checks.md',
		lens: 'decisions',
	};
	const report = {
		planName: 'packages-to-src',
		grade: 'below-A',
		structural: [finding],
		gaps: [gap],
		phasesChecked: ['phase1-lint-vocabulary.md', 'phase2-cross-phase-checks.md'],
		lenses: ['surface', 'wiring', 'decisions'],
		complete: true,
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
					severity: 'blocking',
					phase: 'plan.md',
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
					phase: 'phase2-cross-phase-checks.md',
					lens: 'decisions',
				},
			],
			phasesChecked: ['phase1-lint-vocabulary.md', 'phase2-cross-phase-checks.md'],
			lenses: ['surface', 'wiring', 'decisions'],
			complete: true,
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

	test('the coverage fields default to an unstated-but-complete pass', () => {
		const parsed = GradeReport.parse({ planName: 'packages-to-src', grade: 'A', passed: true, gradedAt: '2026-08-04T00:00:00.000Z' });

		// the skill reads phasesChecked and lenses off every report, and a report
		// that never says otherwise is a finished one
		expect(parsed.phasesChecked).toStrictEqual([]);
		expect(parsed.lenses).toStrictEqual([]);
		expect(parsed.complete).toBe(true);
		expect(parsed.incompleteReason).toBe(undefined);
	});

	test('an incomplete pass carries the reason it did not finish', () => {
		const { report } = setupReport({ complete: false, incompleteReason: 'phase3-two-stage-draft.md/wiring: rate limited or overloaded' });

		const parsed = GradeReport.parse(report);

		// the human is told which checker was lost, not merely that something was
		expect(parsed.complete).toBe(false);
		expect(parsed.incompleteReason).toBe('phase3-two-stage-draft.md/wiring: rate limited or overloaded');
	});

	test('rejects a gap that carries no phase', () => {
		const { report, gap } = setupReport();
		const unlabelled = { area: gap.area, gap: gap.gap, decision: gap.decision, options: gap.options, lens: gap.lens };

		const result = GradeReport.safeParse({ ...report, gaps: [unlabelled] });

		// the engine stamps the phase after the agent returns, so a persisted gap
		// without one is a report the converge loop cannot navigate
		expect(result.success).toBe(false);
	});

	test('rejects a gap whose lens is outside the three briefs', () => {
		for (const lens of ['Surface', 'structure', '']) {
			const { report, gap } = setupReport();

			const result = GradeReport.safeParse({ ...report, gaps: [{ ...gap, lens }] });

			// ${lens} is not a brief the engine hands a checker, so it cannot be what
			// found this gap
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-boolean complete rather than coercing it to truthiness', () => {
		for (const complete of ['false', 0, 'true']) {
			const { report } = setupReport({ complete });

			const result = GradeReport.safeParse(report);

			// the skill branches on complete to decide whether the grade is a clean
			// bill, so a truthy string must never reach it
			expect(result.success).toBe(false);
		}
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
			gaps: [
				{
					area: 'insufficient-detail',
					gap: 'the move map names no target for tests/helpers',
					decision: 'name the target directory',
					phase: 'plan.md',
					lens: 'surface',
				},
			],
		});

		const parsed = GradeReport.parse(report);

		// the inherited PlanGap default survives the extend — a gap written without
		// options reads back with an empty list, and keeps its attribution
		expect(parsed.gaps[0]).toStrictEqual({
			area: 'insufficient-detail',
			gap: 'the move map names no target for tests/helpers',
			decision: 'name the target directory',
			options: [],
			phase: 'plan.md',
			lens: 'surface',
		});
	});

	test('one malformed structural finding rejects the whole report', () => {
		const { report } = setupReport({
			structural: [{ check: 'path-exists', phase: 'plan.md', issue: 'this entry names no location', fix: 'add one' }],
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

		// grade.json holds the declared fields, whatever else a hand edit added
		expect('gradedBy' in parsed).toBe(false);
	});
});
