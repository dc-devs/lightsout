import { describe, expect, jest, test } from '@jest/globals';
import type { PlanDocument } from '@lightsout/engine';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunDetail } from '#src/features/runDetail/index.ts';
import { buildRunView } from '#tests/helpers/buildRunView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `getPlanServerFn` runs and only
// the filesystem is stood in for.
const mockGetPlan = jest.fn<(params: { path: string }) => Promise<PlanDocument>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPlan: (params: { path: string }) => mockGetPlan(params) }),
}));
// -------------------------

const runId = 'abcdef0123456789';
const planPath = '.lightsout/plans/add-search.md';
const worklistPath = '.lightsout/runs/abcdef01/worklist.json';
const scopedWorklist = { at: '2026-01-01T00:00:00.000Z', path: 'packages/engine', all: false, batches: [] };

const setupPlanDrawer = ({ plan }: { plan?: PlanDocument } = {}) => {
	const mockWriteText = jest.fn<(text: string) => Promise<void>>();

	mockWriteText.mockResolvedValue();
	// jsdom implements the DOM, not the platform around it: navigator has no
	// clipboard at all, so the property is defined rather than spied on.
	Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, configurable: true });
	mockGetPlan.mockReturnValue(plan === undefined ? new Promise<PlanDocument>(() => undefined) : Promise.resolve(plan));
	renderWithQueryClient({
		ui: <RunDetail runId={runId} />,
		seed: [
			{ queryKey: [QueryKey.Run, runId], data: buildRunView() },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: '/repos/lightsout' } },
		],
	});

	return { mockWriteText, openPlan: () => fireEvent.click(screen.getByRole('button', { name: /^plan:/ })) };
};

describe('RunDetail plan drawer', () => {
	test('shows nothing until a reader asks for the plan', () => {
		setupPlanDrawer();

		const drawer = screen.queryByRole('dialog');

		expect(drawer).not.toBeInTheDocument();
	});

	test('opens the plan the run implemented, rendered as prose', async () => {
		const { openPlan } = setupPlanDrawer({ plan: { path: planPath, kind: 'markdown', text: '# Add search\n' } });

		openPlan();
		const drawer = await screen.findByRole('dialog');

		await waitFor(() => expect(drawer).toHaveTextContent('Add search'));
	});

	test('names the plan it is showing, so a reader knows which file this is', async () => {
		const { openPlan } = setupPlanDrawer({ plan: { path: planPath, kind: 'markdown', text: '# Add search\n' } });

		openPlan();
		const drawer = await screen.findByRole('dialog', { name: planPath });

		expect(drawer).toBeInTheDocument();
	});

	test('waits visibly while the plan is still being read off disk', async () => {
		const { openPlan } = setupPlanDrawer();

		openPlan();
		const drawer = await screen.findByRole('dialog');

		expect(drawer.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
	});

	test("renders a refactor run's frozen work-list as the work it named", async () => {
		const { openPlan } = setupPlanDrawer({
			plan: {
				path: '.lightsout/runs/abcdef01/worklist.json',
				kind: 'worklist',
				worklist: {
					at: '2026-01-01T00:00:00.000Z',
					path: '.',
					all: true,
					batches: [
						{
							id: 'batch-01:size-function:packages/engine',
							rule: 'size-function',
							folder: 'packages/engine',
							blocking: [{ rule: 'size-function', severity: 'blocking', siteKey: 'src/a.ts:doThing', files: [{ path: 'src/a.ts' }], detail: '91 lines' }],
							advisories: [],
						},
					],
				},
			},
		});

		openPlan();
		const drawer = await screen.findByRole('dialog');

		await waitFor(() => expect(drawer).toHaveTextContent('batch-01:size-function:packages/engine'));
		expect(drawer).toHaveTextContent('91 lines');
	});

	test("renders a coverage run's frozen measurement as its totals and its worst files", async () => {
		const { openPlan } = setupPlanDrawer({
			plan: {
				path: '.lightsout/runs/abcdef01/worklist.json',
				kind: 'coverageWorklist',
				coverageWorklist: {
					at: '2026-01-01T00:00:00.000Z',
					totals: [{ scope: 'engine', statementsPct: 91.4, passed: false }],
					files: [{ path: 'packages/engine/src/a.ts', scope: 'engine', statementsPct: 12.5 }],
				},
			},
		});

		openPlan();
		const drawer = await screen.findByRole('dialog');

		await waitFor(() => expect(drawer).toHaveTextContent('below threshold'));
		expect(drawer).toHaveTextContent('12.5%');
	});

	test('marks a scope already over its bar as passing, so it reads apart from the ones still short', async () => {
		const { openPlan } = setupPlanDrawer({
			plan: {
				path: worklistPath,
				kind: 'coverageWorklist',
				coverageWorklist: {
					at: '2026-01-01T00:00:00.000Z',
					totals: [{ scope: 'shared', statementsPct: 98.2, passed: true }],
					files: [],
				},
			},
		});

		openPlan();
		const drawer = await screen.findByRole('dialog');

		await waitFor(() => expect(drawer).toHaveTextContent('shared — 98.2% passing'));
	});

	test('says a plan is gone rather than showing an empty drawer, and names what is missing', async () => {
		const { openPlan } = setupPlanDrawer({ plan: { path: planPath, kind: 'missing' } });

		openPlan();
		const drawer = await screen.findByRole('dialog');

		await waitFor(() => expect(drawer).toHaveTextContent(/Nothing is on disk at/));
	});

	test('offers the raw document to the clipboard, so a reader can take it elsewhere', async () => {
		const { openPlan } = setupPlanDrawer({ plan: { path: planPath, kind: 'markdown', text: '# Add search\n' } });

		openPlan();
		const copy = await screen.findByRole('button', { name: 'Copy raw' });

		expect(copy).toBeInTheDocument();
	});

	test("hands the clipboard a plan's own markdown, unrendered", async () => {
		const { openPlan, mockWriteText } = setupPlanDrawer({ plan: { path: planPath, kind: 'markdown', text: '# Add search\n' } });

		openPlan();
		const copy = await screen.findByRole('button', { name: 'Copy raw' });
		await act(async () => {
			fireEvent.click(copy);
		});

		expect(mockWriteText).toHaveBeenCalledWith('# Add search\n');
	});

	test('hands the clipboard a work-list as its JSON, since a work-list has no prose to take', async () => {
		const { openPlan, mockWriteText } = setupPlanDrawer({ plan: { path: worklistPath, kind: 'worklist', worklist: scopedWorklist } });

		openPlan();
		const copy = await screen.findByRole('button', { name: 'Copy raw' });
		await act(async () => {
			fireEvent.click(copy);
		});

		expect(JSON.parse(mockWriteText.mock.calls[0][0])).toStrictEqual(scopedWorklist);
	});

	test('offers nothing to copy while the document is still being read', async () => {
		const { openPlan } = setupPlanDrawer();

		openPlan();
		await screen.findByRole('dialog');

		expect(screen.queryByRole('button', { name: 'Copy raw' })).not.toBeInTheDocument();
	});

	test('closes when a reader is done with it', async () => {
		const { openPlan } = setupPlanDrawer({ plan: { path: planPath, kind: 'markdown', text: '# Add search\n' } });

		openPlan();
		fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
