import { describe, expect, jest, test } from '@jest/globals';
import type { RunView } from '@lightsout/engine';
import { PipelineKind } from '@lightsout/engine/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toRunDetailView } from '#src/features/runDetail/common/utils/toRunDetailView.ts';
import { RunDetailBody } from '#src/features/runDetail/screens/RunDetail/components/RunDetailBody.tsx';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildRunStep } from '#tests/helpers/buildRunStep.ts';
import { buildRunView } from '#tests/helpers/buildRunView.ts';

// Mocked Imports
// -------------------------
// Only the link, which needs a live router around it to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------
// jsdom implements the DOM but not scrolling, so the card the body jumps to has
// no such method to call. This stand-in is also what the assertion reads.
const mockScrollIntoView = jest.fn<(options: ScrollIntoViewOptions) => void>();

Object.assign(HTMLElement.prototype, { scrollIntoView: mockScrollIntoView });
// -------------------------

const parent = { runId: 'ffff0000ffff0000', step: 'phase2-indexing.md', title: 'add search' };

const setupRunDetailBody = ({ overrides = {}, linksDisabled, tab }: { overrides?: Partial<RunView>; linksDisabled?: boolean; tab?: string } = {}) => {
	jest.useFakeTimers();

	const view = toRunDetailView({ view: buildRunView({ overrides }) });

	render(<RunDetailBody view={view} onOpenPlan={() => {}} linksDisabled={linksDisabled} />);

	if (tab !== undefined) {
		// A tab strip selects on the press, not on the release.
		fireEvent.mouseDown(screen.getByRole('tab', { name: tab }));
	}

	return { view };
};

describe('RunDetailBody', () => {
	test('names the run it was handed, without asking a query for it', () => {
		setupRunDetailBody();

		const heading = screen.getByRole('heading', { level: 1, name: 'add search' });

		expect(heading).toBeInTheDocument();
	});

	test('splits the evidence into tabs, in the order the report card prints it', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'implement' } })] } });

		const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);

		expect(tabs).toStrictEqual(['Overview', 'Steps', 'Gates', 'Agents', 'Files', 'Friction']);
	});

	test('opens on the overview, so a reader lands on where the time went', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'implement' } })] } });

		expect(screen.getByRole('heading', { level: 2, name: 'Timeline' })).toBeInTheDocument();
	});

	test('keeps a panel out of the tree until its tab is chosen', () => {
		setupRunDetailBody();

		expect(screen.queryByRole('heading', { level: 2, name: 'Gate evidence' })).not.toBeInTheDocument();
	});

	test('shows the panel a reader chose', () => {
		setupRunDetailBody({ tab: 'Gates' });

		expect(screen.getByRole('heading', { level: 2, name: 'Gate evidence' })).toBeInTheDocument();
	});

	test('opens the step a reader picked on the overview in the Steps tab, scrolled to its card', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'implement' } })] } });

		fireEvent.click(screen.getByRole('button', { name: /implement/ }));
		jest.advanceTimersByTime(20);

		expect(screen.getByRole('article')).toHaveAttribute('id', 'step-implement');
		expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
	});

	test('renders a coordinator’s phase run as plain text when links are off', () => {
		setupRunDetailBody({
			overrides: {
				listing: { ...buildRunListing(), pipeline: PipelineKind.Phases },
				steps: [buildRunStep({ overrides: { id: 'phase-1', childRunId: 'aaaa1111bbbb2222', planPath: '.lightsout/plans/web-app/phase1-shell.md' } })],
			},
			linksDisabled: true,
		});

		expect(screen.queryByRole('link', { name: 'aaaa1111' })).not.toBeInTheDocument();
		expect(screen.getByText('phase1-shell.md').parentElement).toHaveTextContent('aaaa1111');
	});

	test('links to the coordinator a phase run belongs to, which is what the live page does', () => {
		setupRunDetailBody({ overrides: { parent } });

		const link = screen.getByRole('link', { name: 'add search' });

		expect(link).toHaveAttribute('href', '/repo/runs/ffff0000ffff0000');
	});

	test('renders that same parent as plain text when links are off, since the demo frame’s targets are not routable', () => {
		setupRunDetailBody({ overrides: { parent }, linksDisabled: true });

		expect(screen.queryByRole('link', { name: 'add search' })).not.toBeInTheDocument();
		expect(screen.getAllByText('add search').length).toBeGreaterThan(0);
	});

	test('links to the run a phase step spawned', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'phase-1', childRunId: 'aaaa1111bbbb2222' } })] }, tab: 'Steps' });

		const link = screen.getByRole('link', { name: 'aaaa1111' });

		expect(link).toHaveAttribute('href', '/repo/runs/aaaa1111bbbb2222');
	});

	test('renders that child run as plain text when links are off', () => {
		setupRunDetailBody({
			overrides: { steps: [buildRunStep({ overrides: { id: 'phase-1', childRunId: 'aaaa1111bbbb2222' } })] },
			linksDisabled: true,
			tab: 'Steps',
		});

		expect(screen.queryByRole('link', { name: 'aaaa1111' })).not.toBeInTheDocument();
		expect(screen.getByText('aaaa1111')).toBeInTheDocument();
	});

	test('links to the run a phase report names', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'phase-1', report: { runId: 'cccc3333dddd4444' } } })] }, tab: 'Steps' });

		const link = screen.getByRole('link', { name: 'cccc3333' });

		expect(link).toHaveAttribute('href', '/repo/runs/cccc3333dddd4444');
	});

	test('renders that report’s run as plain text when links are off', () => {
		setupRunDetailBody({
			overrides: { steps: [buildRunStep({ overrides: { id: 'phase-1', report: { runId: 'cccc3333dddd4444' } } })] },
			linksDisabled: true,
			tab: 'Steps',
		});

		expect(screen.queryByRole('link', { name: 'cccc3333' })).not.toBeInTheDocument();
		expect(screen.getByText('cccc3333')).toBeInTheDocument();
	});

	test.each([
		{ tab: 'Agents', panel: 'Agent cost' },
		{ tab: 'Files', panel: 'Changed files · 0' },
		{ tab: 'Friction', panel: 'Friction' },
	])('shows the $panel panel behind the $tab tab', ({ tab, panel }) => {
		setupRunDetailBody({ tab });

		const heading = screen.getByRole('heading', { level: 2, name: panel });

		expect(heading).toBeInTheDocument();
	});

	test('compresses a step to one row of what it cost on the overview', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'implement', attempts: 2, costUsd: 1.5 } })] } });

		const row = screen.getByRole('button', { name: /implement/ });

		expect(row).toHaveTextContent(/6m 00s · 2 attempts · 1 file · \$1\.50/);
	});

	test('reads a refactor batch on the overview as how it ended and what it left standing', () => {
		setupRunDetailBody({
			overrides: {
				steps: [buildRunStep({ overrides: { id: 'batch-01', report: { outcome: 'declined', remainingSiteKeys: ['src/a.ts:doThing'], rationale: [] } } })],
			},
		});

		const row = screen.getByRole('button', { name: /batch-01/ });

		expect(row).toHaveTextContent('declined · 1 site still standing');
	});

	test('reads a coordinator’s phase step on the overview as the run that implemented it', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'phase-1', report: { runId: 'cccc3333dddd4444' } } })] } });

		const row = screen.getByRole('button', { name: /phase-1/ });

		expect(row).toHaveTextContent('implemented by run cccc3333');
	});

	test('reads a writers envelope on the overview as how many batches ran and what they touched', () => {
		setupRunDetailBody({
			overrides: {
				steps: [
					buildRunStep({
						overrides: {
							id: 'write-tests',
							report: {
								reports: [
									{ status: 'complete', summary: 'covered the reader', changedFiles: [{ path: 'src/a.unit.test.ts', summary: 'new' }], failures: [] },
									{ status: 'complete', summary: 'covered the writer', changedFiles: [], failures: [] },
								],
							},
						},
					}),
				],
			},
		});

		const row = screen.getByRole('button', { name: /write-tests/ });

		expect(row).toHaveTextContent('2 writer batches · 1 file');
	});

	test('reads a working agent’s report on the overview as the summary it wrote', () => {
		setupRunDetailBody({
			overrides: {
				steps: [
					buildRunStep({ overrides: { id: 'implement', report: { status: 'complete', summary: 'the reader is covered', changedFiles: [], failures: [] } } }),
				],
			},
		});

		const row = screen.getByRole('button', { name: /implement/ });

		expect(row).toHaveTextContent('the reader is covered');
	});

	test('leaves a report matching no contract off the overview row, since its JSON is a tab away', () => {
		setupRunDetailBody({ overrides: { steps: [buildRunStep({ overrides: { id: 'implement', report: { shape: 'nobody anticipated' } } })] } });

		const row = screen.getByRole('button', { name: /implement/ });

		expect(row).not.toHaveTextContent('nobody anticipated');
	});
});
