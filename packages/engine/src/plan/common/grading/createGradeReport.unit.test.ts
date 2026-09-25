import { describe, expect, test } from '@jest/globals';
import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { GapArea } from '#src/contracts/plan/grade/GapArea.ts';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import type { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
import { PlanWeight } from '#src/contracts/plan/grade/PlanWeight.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import { GradeScope } from '#src/contracts/plan/memory/GradeScope.ts';
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

/**
 * The report a case grades, defaulting to a finished full pass over one plan
 * file that owed a reader, was read, and had nothing wrong.
 */
const setupReport = ({
	gaps = [],
	structural = [],
	failures = [],
	phases,
	commit,
	treeDirty,
	phasesRequired = ['plan.md'],
	phasesChecked = phasesRequired,
	phasesLight = [],
	documentationComplete = true,
}: {
	gaps?: GradedGap[];
	structural?: StructuralFinding[];
	failures?: string[];
	phases?: string[];
	commit?: string;
	treeDirty?: boolean;
	phasesRequired?: string[];
	phasesChecked?: string[];
	phasesLight?: string[];
	documentationComplete?: boolean;
} = {}) =>
	createGradeReport({
		name: 'graded',
		phases,
		structural,
		gaps,
		failures,
		phasesChecked,
		phasesLight,
		commit,
		treeDirty,
		phasesRequired,
		documentationComplete,
	});

/**
 * The report a read-coverage case grades: a focused pass over a two-file plan,
 * defaulting to one that read the first file, whose coverage stands for both,
 * and whose whole-plan documentation record stands too.
 */
const setupCoveredReport = ({
	phasesChecked = ['phase1-core.md'],
	gaps = [],
	planFiles = ['phase1-core.md', 'phase2-extra.md'],
	covered = ['phase1-core.md', 'phase2-extra.md'],
	documentationCovered = true,
}: {
	phasesChecked?: string[];
	gaps?: GradedGap[];
	planFiles?: string[];
	covered?: string[];
	documentationCovered?: boolean;
} = {}) =>
	createGradeReport({
		name: 'graded',
		structural: [],
		gaps,
		failures: [],
		phasesChecked,
		scope: GradeScope.Focused,
		focusedOn: phasesChecked,
		phasesRequired: phasesChecked,
		documentationComplete: true,
		planFiles,
		covered,
		documentationCovered,
	});

/**
 * The report of a focused pass over a three-file plan that owed two of them a
 * reader, read both, and found nothing — while the third is covered by no
 * recorded reading, so the plan as a whole is not covered.
 */
const setupFocusedReport = () =>
	setupCoveredReport({
		phasesChecked: ['phase1-core.md', 'phase2-extra.md'],
		planFiles: ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'],
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

	test('a focused pass records the phases it read and is incomplete while a plan file is uncovered', () => {
		const report = setupFocusedReport();

		// a plan no reading covers in full is a partial record, and the reason names
		// the file nothing speaks for rather than the ones this pass did read
		expect(report.complete).toBe(false);
		expect(report.incompleteReason ?? '').toMatch(/phase3-final\.md/);
		expect(report.focusedOn).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
	});

	test('a pass with no reader spawned reports an empty lens list', () => {
		const report = setupReport({ phasesRequired: [], phasesChecked: [] });

		// the field states what ran, so a pass that spawned nothing must not claim three lenses
		expect(report.lenses).toStrictEqual([]);
	});

	test('a pass whose coverage leaves a plan file out is below A whatever the findings say', () => {
		const report = setupCoveredReport({ gaps: [gapOf({ outcome: GapOutcome.AgentCanDecide })], covered: ['phase1-core.md'] });

		// nothing blocking was found, and a plan file nothing has read is reason
		// enough on its own
		expect(report.grade).toBe('below-A');
		expect(report.passed).toBe(false);
		expect(report.scope).toBe('focused');
	});

	test('a focused pass that finished every check it owed is scope-complete and still not complete', () => {
		const report = setupFocusedReport();

		// the two questions are separate: this pass finished every check its own
		// scope called for, and the plan beside it is still not covered in full
		expect({ scopeComplete: report.scopeComplete, complete: report.complete, passed: report.passed }).toStrictEqual({
			scopeComplete: true,
			complete: false,
			passed: false,
		});
	});

	test('a pass missing a phase it owed a reader is not scope-complete', () => {
		const report = setupReport({
			phasesRequired: ['phase1-core.md', 'phase2-extra.md'],
			phasesChecked: ['phase1-core.md'],
		});

		// no failure was reported, yet phase 2 has no evidence that every lens returned for it
		expect(report.scopeComplete).toBe(false);
	});

	test('a pass leaving a finding unjudged is not scope-complete', () => {
		const report = setupReport({ gaps: [gapOf({ outcome: GapOutcome.Unjudged })] });

		// no memory record carries an unjudged question, so its plan file must be read again
		expect(report.scopeComplete).toBe(false);
	});

	test('a pass whose every file weighed light is scope-complete and claims no lens', () => {
		const report = setupReport({ phasesRequired: [], phasesChecked: [], phasesLight: ['plan.md'] });

		// a light file is a deliberate exemption, not an unread file
		expect({ scopeComplete: report.scopeComplete, lenses: report.lenses }).toStrictEqual({ scopeComplete: true, lenses: [] });
	});

	test('a pass that offered no plan file at all is not scope-complete', () => {
		const report = setupReport({ phasesRequired: [], phasesChecked: [], phasesLight: [] });

		// a pass that established nothing must remember nothing
		expect({ scopeComplete: report.scopeComplete, lenses: report.lenses }).toStrictEqual({ scopeComplete: false, lenses: [] });
	});

	test('a pass whose documentation checker did not finish is not scope-complete', () => {
		const report = setupReport({ documentationComplete: false });

		expect(report.scopeComplete).toBe(false);
	});

	test('a plan file left uncovered makes the pass incomplete and is named in the reason', () => {
		const report = setupCoveredReport({ covered: ['phase1-core.md'] });

		// a partial reading must never read as a clean bill
		expect(report.complete).toBe(false);
		expect(report.incompleteReason ?? '').toMatch(/phase2-extra\.md/);
		expect(report.grade).toBe('below-A');
	});

	test('a focused pass whose coverage covers every plan file is complete and may be an A', () => {
		const report = setupCoveredReport();

		// approval rides on coverage, not on how far this one pass reached
		expect({ complete: report.complete, grade: report.grade, passed: report.passed, scope: report.scope }).toStrictEqual({
			complete: true,
			grade: 'A',
			passed: true,
			scope: 'focused',
		});
		expect(report.incompleteReason).toBe(undefined);
	});

	test('a deliverable that offered no plan file covers nothing and says so', () => {
		const report = setupCoveredReport({ planFiles: [], covered: [] });

		// an empty plan-file set would otherwise satisfy "every plan file is
		// covered" vacuously, and a pass that established nothing must not read as
		// one that covered everything
		expect(report.complete).toBe(false);
		expect(report.incompleteReason ?? '').toMatch(/no plan file was offered/);
		expect(report.covered).toStrictEqual([]);
	});

	test('stale documentation coverage keeps the pass incomplete however the plan files read', () => {
		const report = setupCoveredReport({ documentationCovered: false });

		// an A granted having never run the documentation checker since the baseline
		expect(report.complete).toBe(false);
		expect(report.incompleteReason ?? '').toMatch(/documentation/i);
		expect(report.grade).toBe('below-A');
	});
});
