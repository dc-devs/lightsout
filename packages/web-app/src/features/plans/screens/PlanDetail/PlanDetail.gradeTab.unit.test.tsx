import { describe, expect, jest, test } from '@jest/globals';
import type { PlanDocument, PlanWorkspaceView } from '@lightsout/engine';
import { FindingSeverity, GapArea, GapCheckLens, GapOutcome, PlanDocumentKind, PlanGrade, StructuralCheck } from '@lightsout/engine/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { PlanDetail } from '#src/features/plans/index.ts';
import { buildPlanWorkspaceView } from '#tests/helpers/buildPlanWorkspaceView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Nothing in this tab opens a file — it reads the grade record the workspace
// view already carries — but the Plan tab beside it does, so the reader is stood
// in for to keep the module graph off disk.
jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPlan: ({ path }: { path: string }) => Promise.resolve<PlanDocument>({ path, kind: PlanDocumentKind.Missing }) }),
}));
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const name = 'add-search';

const setupPlanDetail = ({ overrides = {} }: { overrides?: Partial<PlanWorkspaceView> } = {}) => {
	renderWithQueryClient({
		ui: <PlanDetail name={name} />,
		seed: [{ queryKey: [QueryKey.PlanWorkspace, name], data: buildPlanWorkspaceView({ overrides }) }],
	});
};

/** The tab a reader moved to; Radix opens a tab on pointer-down rather than on click. */
const openTab = ({ tab }: { tab: string }) => fireEvent.mouseDown(screen.getByRole('tab', { name: tab }));
/** The one list row holding a gap, so a tag can be asserted on that gap rather than on the whole tab. */
const gapRow = ({ gap }: { gap: string }) => {
	const row = screen.getByText(gap).closest('li');

	if (row === null) {
		throw new Error('no gap row holding that text');
	}

	return row;
};

describe('PlanDetail grade tab', () => {
	test('shows the grade, the verdict, and the evidence behind both', () => {
		setupPlanDetail({
			overrides: {
				grade: {
					planName: name,
					grade: PlanGrade.BelowA,
					structural: [
						{
							check: StructuralCheck.PathExists,
							severity: FindingSeverity.Blocking,
							phase: 'plan.md',
							issue: 'names a file that is not on disk',
							location: 'Files to Modify',
							fix: 'name the file that is',
						},
					],
					gaps: [
						{
							area: GapArea.OmittedDecision,
							gap: 'the prefix is not settled',
							decision: 'which prefix does the route use?',
							options: ['/repo', '/local'],
							phase: 'plan.md',
							lens: GapCheckLens.Decisions,
							outcome: GapOutcome.NeedsAHuman,
						},
						{
							// A gap the checker could not name options for: the line is left
							// off rather than printed empty.
							area: GapArea.AmbiguousBoundary,
							gap: 'the boundary is not drawn',
							decision: 'where does the feature end?',
							options: [],
							phase: 'plan.md',
							lens: GapCheckLens.Wiring,
							outcome: GapOutcome.NeedsAHuman,
						},
					],
					phasesChecked: ['plan.md'],
					lenses: [GapCheckLens.Decisions, GapCheckLens.Wiring],
					complete: true,
					passed: false,
					gradedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Grade' });

		expect(screen.getByText('below A')).toBeInTheDocument();
		expect(screen.getByText('has not reached the bar implement assumes')).toBeInTheDocument();
		expect(screen.getByText('names a file that is not on disk')).toBeInTheDocument();
		expect(screen.getByText('Decision: which prefix does the route use?')).toBeInTheDocument();
		expect(screen.getByText('Options: /repo / /local')).toBeInTheDocument();
		expect(screen.getByText('Decision gaps (2)')).toBeInTheDocument();
	});

	// The whole-plan documentation checker answers under no per-file lens, so its
	// finding carries none. The tag has to be left off that row entirely, rather
	// than printed empty beside the rows a lens did find.
	test('leaves the lens tag off a finding no lens produced, and keeps it on one a lens found', () => {
		setupPlanDetail({
			overrides: {
				grade: {
					planName: name,
					grade: PlanGrade.BelowA,
					structural: [],
					gaps: [
						{
							area: GapArea.MissingDocumentation,
							gap: 'the new config key is documented nowhere',
							decision: 'which declared document states the new key?',
							options: ['docs/configuration.md', 'nothing user-facing after all'],
							phase: 'plan.md',
							outcome: GapOutcome.NeedsAHuman,
						},
						{
							area: GapArea.UnwiredDependency,
							gap: 'the reader is never exported',
							decision: 'which barrel exports it?',
							options: [],
							phase: 'plan.md',
							lens: GapCheckLens.Wiring,
							outcome: GapOutcome.NeedsAHuman,
						},
					],
					phasesChecked: ['plan.md'],
					lenses: [GapCheckLens.Wiring],
					complete: true,
					passed: false,
					gradedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Grade' });

		expect(within(gapRow({ gap: 'the new config key is documented nowhere' })).queryByText('wiring')).not.toBeInTheDocument();
		expect(within(gapRow({ gap: 'the reader is never exported' })).getByText('wiring')).toBeInTheDocument();
		expect(screen.getByText('missing-documentation')).toBeInTheDocument();
		expect(screen.getByText('Decision: which declared document states the new key?')).toBeInTheDocument();
		expect(screen.getByText('Options: docs/configuration.md / nothing user-facing after all')).toBeInTheDocument();
	});

	test('says a pass that did not finish is partial, so it can never be skimmed as a clean bill', () => {
		setupPlanDetail({
			overrides: {
				grade: {
					planName: name,
					grade: PlanGrade.BelowA,
					structural: [],
					gaps: [],
					phasesChecked: [],
					lenses: [],
					complete: false,
					incompleteReason: 'a checker hit the rate-limit wall',
					passed: false,
					gradedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Grade' });

		expect(screen.getByText(/a checker hit the rate-limit wall/)).toBeInTheDocument();
		expect(screen.getByText('Nothing mechanical is wrong with this plan.')).toBeInTheDocument();
		expect(screen.getByText('Nothing here would make an implementing agent guess.')).toBeInTheDocument();
	});

	// The sentence has to end where it ends: a pass that stopped without saying
	// why must not trail a colon into nothing.
	test('still says an unfinished pass is partial when nothing recorded why it stopped', () => {
		setupPlanDetail({
			overrides: {
				grade: {
					planName: name,
					grade: PlanGrade.BelowA,
					structural: [],
					gaps: [],
					phasesChecked: [],
					lenses: [],
					complete: false,
					passed: false,
					gradedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Grade' });

		expect(screen.getByText(/did not finish/).textContent).toBe('This pass did not finish, so the findings below are real but partial');
	});

	test('says out loud that a plan cleared the bar, which is what grading one is for', () => {
		setupPlanDetail({
			overrides: {
				grade: {
					planName: name,
					grade: PlanGrade.A,
					structural: [],
					gaps: [],
					phasesChecked: ['plan.md'],
					lenses: [GapCheckLens.Decisions],
					complete: true,
					passed: true,
					gradedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Grade' });

		expect(screen.getByText('passed the bar implement assumes')).toBeInTheDocument();
		expect(screen.getByText('A')).toBeInTheDocument();
	});

	// The colour, not the word: a finding that gates nothing must not be dressed
	// like one that stops the plan, and only the class says which it is.
	test.each([
		{ severity: FindingSeverity.Blocking, family: 'blocking', token: 'text-severity-blocking' },
		{ severity: FindingSeverity.Advisory, family: 'advisory', token: 'text-severity-advisory' },
	])('wears the $family colours on a structural finding of that severity', ({ severity, token }) => {
		setupPlanDetail({
			overrides: {
				grade: {
					planName: name,
					grade: PlanGrade.BelowA,
					structural: [
						{
							check: StructuralCheck.ScriptExists,
							severity,
							phase: 'plan.md',
							issue: 'names a script no package has',
							location: 'Verification',
							fix: 'name one that exists',
						},
					],
					gaps: [],
					phasesChecked: ['plan.md'],
					lenses: [GapCheckLens.Wiring],
					complete: true,
					passed: false,
					gradedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Grade' });

		expect(screen.getByText('script-exists').className).toContain(token);
	});

	test('says a plan has not been graded, and names the command that grades it', () => {
		setupPlanDetail();

		openTab({ tab: 'Grade' });

		expect(screen.getByText(/Not graded yet — run lightsout plan grade --name <name>\./)).toBeInTheDocument();
	});
});
