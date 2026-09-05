import { describe, expect, jest, test } from '@jest/globals';
import type { PlanDocument, PlanWorkspaceView } from '@lightsout/engine';
import { PlanDocumentKind, PlanGrade, PlanStage } from '@lightsout/engine/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { PlanDetail } from '#src/features/plans/index.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';
import { buildPlanWorkspaceView } from '#tests/helpers/buildPlanWorkspaceView.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `getPlanServerFn` runs behind
// every markdown file this page opens and only the filesystem is stood in for.
const mockGetPlan = jest.fn<(params: { path: string }) => Promise<PlanDocument>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPlan: (params: { path: string }) => mockGetPlan(params) }),
}));
// -------------------------
// The breadcrumb and every run link need a live router to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const name = 'add-search';

const setupPlanDetail = ({ view = buildPlanWorkspaceView(), text = '# the plan' }: { view?: PlanWorkspaceView; text?: string } = {}) => {
	mockGetPlan.mockImplementation(({ path }) => Promise.resolve({ path, kind: PlanDocumentKind.Markdown, text }));
	renderWithQueryClient({ ui: <PlanDetail name={name} />, seed: [{ queryKey: [QueryKey.PlanWorkspace, name], data: view }] });

	return { view };
};

/** The tab a reader moved to; Radix opens a tab on pointer-down rather than on click. */
const openTab = ({ tab }: { tab: string }) => fireEvent.mouseDown(screen.getByRole('tab', { name: tab }));

/**
 * One phase row, opened.
 *
 * jsdom implements no activation behaviour for `<summary>` — a click on it
 * leaves the disclosure shut — so the row is opened through the property a
 * browser's own click would set, followed by the `toggle` event the browser
 * would then fire.
 */
const openPhaseRow = ({ file }: { file: HTMLElement }) => {
	const row = file.closest('details');

	if (row === null) {
		throw new Error('no phase row holding that file');
	}

	row.open = true;
	fireEvent(row, new Event('toggle'));
};

describe('PlanDetail', () => {
	test('names the plan and says how far it got', async () => {
		setupPlanDetail({
			view: buildPlanWorkspaceView({
				overrides: { listing: buildPlanWorkspaceListing({ name, stage: PlanStage.Graded, grade: PlanGrade.BelowA }) },
			}),
		});

		expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
		expect(screen.getByText('graded')).toBeInTheDocument();
		expect(await screen.findByText('below A')).toBeInTheDocument();
	});

	test('shows where the workspace is on disk, since that is what a reader would open next', () => {
		setupPlanDetail();

		expect(screen.getByText('/repos/lightsout/.lightsout/plans/add-search')).toBeInTheDocument();
	});

	test('says out loud that no run has been started from the plan yet', () => {
		setupPlanDetail();

		expect(screen.getByText('No run has been started from this plan yet.')).toBeInTheDocument();
	});

	test('links every run that implemented the plan, so the decide half reaches the execute half', () => {
		setupPlanDetail({
			view: buildPlanWorkspaceView({ overrides: { runs: [buildRunListing({ runId: 'abcdef0123456789', title: 'phase 1' })] } }),
		});

		expect(screen.getByRole('link', { name: /phase 1/ })).toHaveAttribute('href', '/repo/runs/abcdef0123456789');
	});

	test('says which file would not parse, rather than rendering a corrupt workspace as an empty one', () => {
		setupPlanDetail({ view: buildPlanWorkspaceView({ overrides: { problems: ['grade.json is not valid JSON'] } }) });

		expect(screen.getByText('grade.json is not valid JSON')).toBeInTheDocument();
	});

	test('opens on the plan itself, read through the same query a run’s plan drawer uses', async () => {
		setupPlanDetail({ text: '# the drafted plan' });

		expect(await screen.findByText('# the drafted plan')).toBeInTheDocument();
		expect(mockGetPlan).toHaveBeenCalledWith({ path: '.lightsout/plans/add-search/plan.md' });
	});

	test('says a workspace has no drafted plan yet, and names the command that writes one', () => {
		setupPlanDetail({ view: buildPlanWorkspaceView({ overrides: { planFile: undefined } }) });

		expect(screen.getByText(/No plan drafted yet — run lightsout plan draft --name add-search\./)).toBeInTheDocument();
	});

	test('names each phase file and its size without fetching any of them, since ten of them would be a megabyte', async () => {
		setupPlanDetail({
			view: buildPlanWorkspaceView({
				overrides: {
					planFile: { name: 'overview.md', path: '.lightsout/plans/add-search/overview.md', bytes: 900, updatedAt: '2026-01-01T00:00:00.000Z' },
					phaseFiles: [{ name: 'phase1-schema.md', path: '.lightsout/plans/add-search/phase1-schema.md', bytes: 4300, updatedAt: '2026-01-01T00:00:00.000Z' }],
				},
			}),
		});

		expect(await screen.findByText('phase1-schema.md')).toBeInTheDocument();
		expect(screen.getByText('4.2 KB')).toBeInTheDocument();
		expect(mockGetPlan).not.toHaveBeenCalledWith({ path: '.lightsout/plans/add-search/phase1-schema.md' });
	});

	test('fetches a phase file only once a reader opens it', async () => {
		setupPlanDetail({
			text: '# phase one',
			view: buildPlanWorkspaceView({
				overrides: {
					planFile: { name: 'overview.md', path: '.lightsout/plans/add-search/overview.md', bytes: 900, updatedAt: '2026-01-01T00:00:00.000Z' },
					phaseFiles: [{ name: 'phase1-schema.md', path: '.lightsout/plans/add-search/phase1-schema.md', bytes: 4300, updatedAt: '2026-01-01T00:00:00.000Z' }],
				},
			}),
		});

		openPhaseRow({ file: await screen.findByText('phase1-schema.md') });

		await waitFor(() => expect(mockGetPlan).toHaveBeenCalledWith({ path: '.lightsout/plans/add-search/phase1-schema.md' }));
	});

	test('names the archived phases and the agent transcripts and renders neither, which is what a log viewer would be', async () => {
		setupPlanDetail({
			view: buildPlanWorkspaceView({
				overrides: {
					listing: buildPlanWorkspaceListing({
						name,
						implementedFiles: [
							{
								name: 'implemented/phase1-design.md',
								path: '.lightsout/plans/add-search/implemented/phase1-design.md',
								bytes: 2048,
								updatedAt: '2026-01-01T00:00:00.000Z',
							},
						],
					}),
					transcripts: [
						{ name: 'draft-stream.jsonl', path: '.lightsout/plans/add-search/draft-stream.jsonl', bytes: 716_800, updatedAt: '2026-01-01T00:00:00.000Z' },
					],
				},
			}),
		});

		expect(await screen.findByText('implemented/phase1-design.md')).toBeInTheDocument();
		expect(screen.getByText('draft-stream.jsonl')).toBeInTheDocument();
		expect(screen.getByText('700.0 KB')).toBeInTheDocument();
	});

	test('reads a plan file that has since been deleted as a recorded absence, not an error', async () => {
		mockGetPlan.mockImplementation(({ path }) => Promise.resolve({ path, kind: PlanDocumentKind.Missing }));
		renderWithQueryClient({ ui: <PlanDetail name={name} />, seed: [{ queryKey: [QueryKey.PlanWorkspace, name], data: buildPlanWorkspaceView() }] });

		expect(await screen.findByText('Nothing is on disk at that path any more.')).toBeInTheDocument();
	});

	test('shows the notes /brainstorm wrote, and says so when it wrote none', async () => {
		setupPlanDetail();

		openTab({ tab: 'Notes' });

		expect(await screen.findByText(/No notes — \/brainstorm writes them/)).toBeInTheDocument();
	});

	test('renders the notes file when the workspace has one', async () => {
		setupPlanDetail({
			text: '# the rough idea',
			view: buildPlanWorkspaceView({
				overrides: {
					notesFile: {
						name: 'brainstorm-notes.md',
						path: '.lightsout/plans/add-search/brainstorm-notes.md',
						bytes: 400,
						updatedAt: '2026-01-01T00:00:00.000Z',
					},
				},
			}),
		});

		openTab({ tab: 'Notes' });

		expect(await screen.findByText('# the rough idea')).toBeInTheDocument();
	});

	// The colour family, not just the word: the stages are deliberately dressed
	// as a progression rather than as run outcomes, and only the class says so.
	test.each([
		{ stage: PlanStage.Started, label: 'started', family: 'neutral', token: 'text-muted-foreground-strong' },
		{ stage: PlanStage.NotesOnly, label: 'notes only', family: 'neutral', token: 'text-muted-foreground-strong' },
		{ stage: PlanStage.Drafted, label: 'drafted', family: 'advisory', token: 'text-severity-advisory' },
		{ stage: PlanStage.Graded, label: 'graded', family: 'running', token: 'text-status-running' },
		{ stage: PlanStage.Implemented, label: 'implemented', family: 'passed', token: 'text-status-passed' },
	])('wears the $family colours at the $label stage, so the badges read as how far along the plan is', async ({ stage, label, token }) => {
		setupPlanDetail({ view: buildPlanWorkspaceView({ overrides: { listing: buildPlanWorkspaceListing({ name, stage }) } }) });

		const badge = await screen.findByText(label);

		expect(badge.className).toContain(token);
	});

	// Below A is advisory rather than failed on purpose: a plan that has not
	// reached A is unfinished, and the colour must not call it broken.
	test.each([
		{ grade: PlanGrade.A, label: 'A', family: 'passed', token: 'text-status-passed' },
		{ grade: PlanGrade.BelowA, label: 'below A', family: 'advisory', token: 'text-severity-advisory' },
	])('wears the $family colours for a plan graded $label', async ({ grade, label, token }) => {
		setupPlanDetail({ view: buildPlanWorkspaceView({ overrides: { listing: buildPlanWorkspaceListing({ name, grade }) } }) });

		const badge = await screen.findByText(label);

		expect(badge.className).toContain(token);
	});
});
