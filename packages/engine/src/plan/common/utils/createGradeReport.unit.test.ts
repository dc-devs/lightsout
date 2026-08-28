import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, GapArea, GapCheckLens, GapOutcome, type GradedGap, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { createGradeReport } from '#src/plan/common/utils/createGradeReport.ts';

/** One judged reader finding, carrying only the outcome each case turns on. */
const gapOf = ({ outcome }: { outcome: GapOutcome }): GradedGap => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: [],
	phase: 'plan.md',
	lens: GapCheckLens.Decisions,
	outcome,
});

/** One structural finding at the given severity. */
const findingOf = ({ severity }: { severity: FindingSeverity }): StructuralFinding => ({
	check: severity === FindingSeverity.Advisory ? StructuralCheck.ScopeWithinGuardrail : StructuralCheck.PathExists,
	severity,
	phase: 'plan.md',
	issue: 'the file does not exist',
	location: 'Files to Modify → src/missing.ts',
	fix: 'correct the path or list it under Files to Create',
});

/** The report a case grades, defaulting to a finished pass over one plan file with nothing wrong. */
const setupReport = ({
	gaps = [],
	structural = [],
	failures = [],
	phases,
}: {
	gaps?: GradedGap[];
	structural?: StructuralFinding[];
	failures?: string[];
	phases?: string[];
} = {}) => createGradeReport({ name: 'graded', phases, structural, gaps, failures, phasesChecked: ['plan.md'] });

describe('createGradeReport', () => {
	test('a pass that found nothing at all is an A', () => {
		const report = setupReport();

		expect(report.grade).toBe('A');
		expect(report.passed).toBe(true);
		expect(report.complete).toBe(true);
		expect(report.lenses).toStrictEqual(['surface', 'wiring', 'decisions']);
		expect(report.phasesChecked).toStrictEqual(['plan.md']);
	});

	test('findings the implementing agent can settle are recorded and still grade A', () => {
		const gaps = [gapOf({ outcome: GapOutcome.AgentCanDecide }), gapOf({ outcome: GapOutcome.AlreadyAnswered })];

		const report = setupReport({ gaps });

		// the whole point of judging: a pass that found fourteen notes and no
		// blockers is not the same as one that found fourteen blockers
		expect(report.grade).toBe('A');
		expect(report.gaps).toStrictEqual(gaps);
	});

	test.each<{ label: string; outcome: GapOutcome }>([
		{ label: 'a finding a human must settle', outcome: GapOutcome.NeedsAHuman },
		{ label: 'a finding nobody judged', outcome: GapOutcome.Unjudged },
	])('$label is below-A', ({ outcome }) => {
		const report = setupReport({ gaps: [gapOf({ outcome })] });

		expect(report.grade).toBe('below-A');
		expect(report.passed).toBe(false);
	});

	test('a blocking structural finding is below-A whatever the gaps say', () => {
		const report = setupReport({ structural: [findingOf({ severity: FindingSeverity.Blocking })] });

		expect(report.grade).toBe('below-A');
	});

	test('an advisory structural finding alone is an A, and is still on the report', () => {
		const structural = [findingOf({ severity: FindingSeverity.Advisory })];

		const report = setupReport({ structural });

		// an advisory is a note, not a defect
		expect(report.grade).toBe('A');
		expect(report.structural).toStrictEqual(structural);
	});

	test('a reader that failed makes the pass incomplete, and an incomplete pass is never an A', () => {
		const report = setupReport({ failures: ['plan.md/wiring: rate limited or overloaded'] });

		expect(report.complete).toBe(false);
		expect(report.grade).toBe('below-A');
		expect(report.incompleteReason).toBe('plan.md/wiring: rate limited or overloaded');
	});

	test('a --phase narrowing is recorded on the report and is likewise never an A', () => {
		const report = setupReport({ phases: ['2'] });

		expect(report.complete).toBe(false);
		expect(report.grade).toBe('below-A');
		expect(report.incompleteReason ?? '').toMatch(/graded a subset on request: 2/);
	});
});
