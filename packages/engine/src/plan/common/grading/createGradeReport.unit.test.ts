import { describe, expect, test } from '@jest/globals';
import {
	FindingSeverity,
	GapArea,
	GapCheckLens,
	GapOutcome,
	type GradedGap,
	GradeScope,
	PlanWeight,
	StructuralCheck,
	type StructuralFinding,
} from '#src/contracts/index.ts';
import { createGradeReport } from '#src/plan/common/grading/createGradeReport.ts';

/** One judged reader finding, carrying only the outcome each case turns on. */
const gapOf = ({ outcome }: { outcome: GapOutcome }): GradedGap => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: [],
	phase: 'plan.md',
	lens: GapCheckLens.Decisions,
	outcome,
	observations: [],
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
	commit,
	treeDirty,
}: {
	gaps?: GradedGap[];
	structural?: StructuralFinding[];
	failures?: string[];
	phases?: string[];
	commit?: string;
	treeDirty?: boolean;
} = {}) =>
	createGradeReport({
		name: 'graded',
		phases,
		structural,
		gaps,
		failures,
		phasesChecked: ['plan.md'],
		commit,
		treeDirty,
		phasesRequired: ['plan.md'],
		documentationComplete: true,
	});

/**
 * The report a scope-coverage case grades: a full pass, defaulting to one that
 * owed one plan file a reader, read it, and finished its documentation check.
 */
const setupCoverageReport = ({
	phasesRequired = ['plan.md'],
	phasesChecked = phasesRequired,
	phasesLight = [],
	gaps = [],
	documentationComplete = true,
}: {
	phasesRequired?: string[];
	phasesChecked?: string[];
	phasesLight?: string[];
	gaps?: GradedGap[];
	documentationComplete?: boolean;
} = {}) =>
	createGradeReport({
		name: 'graded',
		structural: [],
		gaps,
		failures: [],
		phasesChecked,
		phasesLight,
		phasesRequired,
		documentationComplete,
	});

/** The report of a focused pass that owed two plan files a reader, read both, and found nothing. */
const setupFocusedReport = () =>
	createGradeReport({
		name: 'graded',
		structural: [],
		gaps: [],
		failures: [],
		phasesChecked: ['phase1-core.md', 'phase2-extra.md'],
		scope: GradeScope.Focused,
		focusedOn: ['phase1-core.md', 'phase2-extra.md'],
		phasesRequired: ['phase1-core.md', 'phase2-extra.md'],
		documentationComplete: true,
	});

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

	test('the commit the pass ran against is stamped on the report', () => {
		const report = setupReport({ commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' });

		// gradedAt says when the grade was taken; this says against what
		expect(report.gradedCommit).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
	});

	test('a pass taken outside a git worktree records no commit rather than inventing one', () => {
		const report = setupReport();

		expect(report.gradedCommit).toBe(undefined);
	});

	test('a dirty working tree is recorded beside the commit, so the sha reads as a floor', () => {
		const report = setupReport({ commit: 'a1b2c3d4e5f6', treeDirty: true });

		expect(report.gradedTreeDirty).toBe(true);
	});

	test('a tree state that was never read is undefined, never false', () => {
		const report = setupReport({ commit: 'a1b2c3d4e5f6' });

		// false would claim a clean tree that was never measured
		expect(report.gradedTreeDirty).toBe(undefined);
	});

	test('a --phase narrowing is recorded on the report and is likewise never an A', () => {
		const report = setupReport({ phases: ['2'] });

		expect(report.complete).toBe(false);
		expect(report.grade).toBe('below-A');
		expect(report.incompleteReason ?? '').toMatch(/graded a subset on request: 2/);
	});

	test('the weights and the light files are recorded on the report exactly as handed in', () => {
		const weights = [
			{ phase: 'phase1-core.md', weight: PlanWeight.Heavy, reasons: ['creates 5 source files, above 3'] },
			{ phase: 'phase2-extra.md', weight: PlanWeight.Light, reasons: [] },
		];

		const report = createGradeReport({
			name: 'graded',
			structural: [],
			gaps: [],
			failures: [],
			phasesChecked: ['phase1-core.md'],
			weights,
			phasesLight: ['phase2-extra.md'],
			phasesRequired: ['phase1-core.md'],
			documentationComplete: true,
		});

		expect(report.weights).toStrictEqual(weights);
		expect(report.phasesLight).toStrictEqual(['phase2-extra.md']);
		// a file some reader read means the lenses really ran
		expect(report.lenses).toStrictEqual(['surface', 'wiring', 'decisions']);
	});

	test('a grade where every file weighed light states no lenses, because no reader ran', () => {
		const report = createGradeReport({
			name: 'graded',
			structural: [],
			gaps: [],
			failures: [],
			phasesChecked: [],
			weights: [{ phase: 'plan.md', weight: PlanWeight.Light, reasons: [] }],
			phasesLight: ['plan.md'],
			phasesRequired: [],
			documentationComplete: true,
		});

		// empty lenses reads as "no reader ran", never as "every lens ran and found nothing"
		expect(report.lenses).toStrictEqual([]);
		expect(report.grade).toBe('A');
	});

	test('a grade taken with the switch off weighs nothing and still states the full lens list', () => {
		const report = setupReport();

		expect({ weights: report.weights, phasesLight: report.phasesLight }).toStrictEqual({ weights: [], phasesLight: [] });
		expect(report.lenses).toStrictEqual(['surface', 'wiring', 'decisions']);
	});

	test('a focused pass is incomplete and names the phases it read', () => {
		const report = setupFocusedReport();

		// a pass that never offered every plan file to the readers is a partial record
		expect(report.complete).toBe(false);
		expect(report.incompleteReason ?? '').toMatch(/phase1-core\.md, phase2-extra\.md/);
		expect(report.focusedOn).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
	});

	test('a pass with no reader spawned reports an empty lens list', () => {
		const report = createGradeReport({
			name: 'graded',
			structural: [],
			gaps: [],
			failures: [],
			phasesChecked: [],
			scope: GradeScope.Full,
			focusedOn: [],
			phasesRequired: [],
			documentationComplete: true,
		});

		// the field states what ran, so a pass that spawned nothing must not claim three lenses
		expect(report.lenses).toStrictEqual([]);
	});

	test('a focused pass with nothing blocking is still below A', () => {
		const report = createGradeReport({
			name: 'graded',
			structural: [],
			gaps: [gapOf({ outcome: GapOutcome.AgentCanDecide })],
			failures: [],
			phasesChecked: ['phase1-core.md'],
			scope: GradeScope.Focused,
			focusedOn: ['phase1-core.md'],
			phasesRequired: ['phase1-core.md'],
			documentationComplete: true,
		});

		// a focused pass is a repair check, never an approval
		expect(report.grade).toBe('below-A');
		expect(report.passed).toBe(false);
		expect(report.scope).toBe('focused');
	});

	test('a focused pass that finished every check it owed is scope-complete and still not complete', () => {
		const report = setupFocusedReport();

		// finishing its own scope is not a whole-plan clean bill
		expect({ scopeComplete: report.scopeComplete, complete: report.complete, passed: report.passed }).toStrictEqual({
			scopeComplete: true,
			complete: false,
			passed: false,
		});
	});

	test('a pass missing a phase it owed a reader is not scope-complete', () => {
		const report = setupCoverageReport({
			phasesRequired: ['phase1-core.md', 'phase2-extra.md'],
			phasesChecked: ['phase1-core.md'],
		});

		// no failure was reported, yet phase 2 has no evidence that every lens returned for it
		expect(report.scopeComplete).toBe(false);
	});

	test('a pass leaving a finding unjudged is not scope-complete', () => {
		const report = setupCoverageReport({ gaps: [gapOf({ outcome: GapOutcome.Unjudged })] });

		// no memory record carries an unjudged question, so its plan file must be read again
		expect(report.scopeComplete).toBe(false);
	});

	test('a pass whose every file weighed light is scope-complete and claims no lens', () => {
		const report = setupCoverageReport({ phasesRequired: [], phasesChecked: [], phasesLight: ['plan.md'] });

		// a light file is a deliberate exemption, not an unread file
		expect({ scopeComplete: report.scopeComplete, lenses: report.lenses }).toStrictEqual({ scopeComplete: true, lenses: [] });
	});

	test('a pass that offered no plan file at all is not scope-complete', () => {
		const report = setupCoverageReport({ phasesRequired: [], phasesChecked: [], phasesLight: [] });

		// a pass that established nothing must remember nothing
		expect({ scopeComplete: report.scopeComplete, lenses: report.lenses }).toStrictEqual({ scopeComplete: false, lenses: [] });
	});

	test('a pass whose documentation checker did not finish is not scope-complete', () => {
		const report = setupCoverageReport({ documentationComplete: false });

		expect(report.scopeComplete).toBe(false);
	});
});
