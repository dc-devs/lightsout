import { describe, expect, jest, test } from '@jest/globals';
import type { PlanDocument, PlanWorkspaceView } from '@lightsout/engine';
import {
	DecisionSource,
	DedupResolution,
	FindingSeverity,
	GapArea,
	GapCheckLens,
	PlanDocumentKind,
	PlanGrade,
	StructuralCheck,
} from '@lightsout/engine/contracts';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { PlanDetail } from '#src/features/plans/index.ts';
import { buildPlanWorkspaceView } from '#tests/helpers/buildPlanWorkspaceView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Nothing in these five tabs opens a file — every one reads a record the
// workspace view already carries — but the Plan tab behind them does, so the
// reader is stood in for to keep the module graph off disk.
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

describe('PlanDetail decisions tab', () => {
	test('lists the brainstorm decisions before the plan’s own, which is the order they were made in', () => {
		setupPlanDetail({
			overrides: {
				brainstormDecisions: {
					planName: name,
					decisions: [
						{ source: DecisionSource.Brainstorm, question: 'build it at all?', options: 'yes / no', choice: 'yes', rationale: 'users ask', assumption: false },
					],
				},
				decisions: {
					planName: name,
					decisions: [
						{ source: DecisionSource.Grill, question: 'one index or two?', options: 'one / two', choice: 'one', rationale: 'simpler', assumption: false },
					],
				},
			},
		});

		openTab({ tab: 'Decisions' });

		const questions = screen
			.getAllByRole('row')
			.slice(1)
			.map((row) => row.querySelectorAll('td')[1]?.textContent);

		expect(questions).toStrictEqual(['build it at all?', 'one index or two?']);
	});

	test('flags a choice nobody confirmed, which is the one row a reader has to be able to spot', () => {
		setupPlanDetail({
			overrides: {
				decisions: {
					planName: name,
					decisions: [{ source: DecisionSource.Converge, question: 'which prefix?', options: 'a / b', choice: 'a', rationale: 'matches', assumption: true }],
				},
			},
		});

		openTab({ tab: 'Decisions' });

		expect(screen.getByText('assumption')).toBeInTheDocument();
	});

	test('says a workspace has recorded no decisions, rather than showing an empty table', () => {
		setupPlanDetail();

		openTab({ tab: 'Decisions' });

		expect(screen.getByText('No decisions recorded — /brainstorm and /plan write them.')).toBeInTheDocument();
	});
});

describe('PlanDetail facts tab', () => {
	test('leads with the request, then what each explorer confirmed on disk', () => {
		setupPlanDetail({
			overrides: {
				facts: {
					request: 'add full-text search',
					areas: [
						{
							area: 'indexing',
							affectedPackages: ['packages/engine'],
							filesToModify: [{ path: 'src/index.ts', role: 'the barrel the reader is exported from' }],
							patternsToMirror: [{ path: 'src/views/listRuns.ts', takeaway: 'the listing habit' }],
							integrationPoints: [{ name: 'listRuns', signature: '({ cwd }) => Promise<RunListing[]>', at: 'src/views/listRuns.ts:17' }],
							scripts: [{ key: 'test:unit', command: 'jest -c jest.config.cjs' }],
							namingConvention: 'camelCase readers named for what they return',
						},
					],
					verification: { pathsChecked: 4, missingPaths: [], scriptsChecked: 1, missingScripts: [] },
					verifiedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Facts' });

		expect(screen.getByText('add full-text search')).toBeInTheDocument();
		expect(screen.getByText('the barrel the reader is exported from')).toBeInTheDocument();
		expect(screen.getByText('4 paths checked')).toBeInTheDocument();
		expect(screen.getByText('every path was there')).toBeInTheDocument();
	});

	test('names the paths a plan claimed and disk did not have', () => {
		setupPlanDetail({
			overrides: {
				facts: {
					request: 'add search',
					// An explorer that recorded nothing but its convention: each list it
					// left empty is left off the card rather than drawn as an empty heading.
					areas: [
						{
							area: 'indexing',
							affectedPackages: [],
							filesToModify: [],
							patternsToMirror: [],
							integrationPoints: [],
							scripts: [],
							namingConvention: 'camelCase readers',
						},
					],
					verification: { pathsChecked: 2, missingPaths: ['src/gone.ts'], scriptsChecked: 0, missingScripts: ['build:index'] },
					verifiedAt: '2026-01-01T00:00:00.000Z',
				},
			},
		});

		openTab({ tab: 'Facts' });

		expect(screen.getByText('missing: src/gone.ts')).toBeInTheDocument();
		expect(screen.getByText('missing: build:index')).toBeInTheDocument();
		expect(screen.queryByText('Files to modify')).not.toBeInTheDocument();
	});

	test('says no facts were recorded, and names the command that records them', () => {
		setupPlanDetail();

		openTab({ tab: 'Facts' });

		expect(screen.getByText(/No facts recorded — run lightsout plan verify-facts --name <name>\./)).toBeInTheDocument();
	});
});

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

describe('PlanDetail dedup tab', () => {
	test('tells a reviewed-and-clean workspace apart from one nobody reviewed', () => {
		setupPlanDetail({ overrides: { dedup: { planName: name, findings: [], complete: true, reviewedAt: '2026-01-01T00:00:00.000Z' } } });

		openTab({ tab: 'Dedup' });

		expect(screen.getByText('No duplication found.')).toBeInTheDocument();
	});

	test('says nobody has reviewed it, and names the command that would', () => {
		setupPlanDetail();

		openTab({ tab: 'Dedup' });

		expect(screen.getByText(/Not reviewed yet — run lightsout plan dedup --name <name>\./)).toBeInTheDocument();
	});

	test('shows each duplication, what it collides with, and what to do about it', () => {
		setupPlanDetail({
			overrides: {
				dedup: {
					planName: name,
					complete: true,
					reviewedAt: '2026-01-01T00:00:00.000Z',
					findings: [
						{
							plannedSymbol: 'formatDate',
							plannedPath: 'src/common/utils/formatDate.ts',
							phase: 'plan.md',
							recommendation: DedupResolution.Reuse,
							rationale: 'the repo already formats dates here',
							migrateCallers: [],
							collidesWith: [{ name: 'formatDate', path: 'src/common/formatting/formatDate.ts' }],
						},
					],
				},
			},
		});

		openTab({ tab: 'Dedup' });

		expect(screen.getByText('the repo already formats dates here')).toBeInTheDocument();
		expect(screen.getByText('formatDate · src/common/formatting/formatDate.ts')).toBeInTheDocument();
	});
});
