import { describe, expect, jest, test } from '@jest/globals';
import type { RunStepView } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunDetail } from '#src/features/runDetail/index.ts';
import { buildRunStep } from '#tests/helpers/buildRunStep.ts';
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

const runId = 'abcdef0123456789';

const setupStep = ({ overrides = {} }: { overrides?: Partial<RunStepView> } = {}) => {
	jest.useFakeTimers();
	renderWithQueryClient({
		ui: <RunDetail runId={runId} />,
		seed: [{ queryKey: [QueryKey.Run, runId], data: buildRunView({ overrides: { steps: [buildRunStep({ overrides })], activeMs: 360_000 } }) }],
	});
};

describe('RunDetail steps', () => {
	test('reports what one step cost beside how it ended', () => {
		setupStep({ overrides: { attempts: 2, invocations: 3, outputTokens: 12_400, costUsd: 1.5 } });

		const card = screen.getByRole('article');

		expect(card).toHaveTextContent(/2 attempts.*1 file.*3 invocations.*out 12\.4k.*\$1\.50/);
	});

	test.each([
		{ status: RunStatus.Running, label: 'running', token: 'text-status-running' },
		{ status: RunStatus.PausedBudget, label: 'paused · budget', token: 'text-status-paused' },
		{ status: RunStatus.Escalated, label: 'escalated', token: 'text-status-escalated' },
	])('says a step ended $label, in the colour that status wears everywhere else', ({ status, label, token }) => {
		setupStep({ overrides: { status } });

		const badge = screen.getByText(label);

		expect(badge.className).toContain(token);
	});

	test('shows the error a failed step recorded', () => {
		setupStep({ overrides: { status: RunStatus.Failed, error: 'the check gate came back non-zero' } });

		const error = screen.getByText('the check gate came back non-zero');

		expect(error).toBeInTheDocument();
	});

	test('says a step recorded no report rather than showing an empty panel', () => {
		setupStep();

		const empty = screen.getByText('No report recorded for this step.');

		expect(empty).toBeInTheDocument();
	});

	test("links a coordinator's step to the run that implemented its phase", () => {
		setupStep({ overrides: { childRunId: 'ffff0000ffff1111', report: { runId: 'ffff0000ffff1111' } } });

		const links = screen.getAllByRole('link', { name: 'ffff0000' });

		expect(links.map((link) => link.getAttribute('href'))).toStrictEqual(['/repo/runs/ffff0000ffff1111', '/repo/runs/ffff0000ffff1111']);
	});

	test("offers a coordinator's phase file to the plan drawer", () => {
		setupStep({ overrides: { planPath: '.lightsout/plans/web-app/phase4-run-detail.md' } });

		const phase = screen.getByRole('button', { name: '.lightsout/plans/web-app/phase4-run-detail.md' });

		expect(phase).toBeInTheDocument();
	});

	test('reads a refactor batch as its outcome, what it left and why', () => {
		setupStep({
			overrides: {
				report: {
					outcome: 'declined',
					remainingSiteKeys: ['src/a.ts:doThing'],
					rationale: ['splitting would hide the flow'],
					advisoryOutcomes: [{ rule: 'size-function', siteKey: 'src/a.ts:doThing', outcome: 'declined', reason: 'the split would hide the flow' }],
				},
			},
		});

		const card = screen.getByRole('article');

		expect(card).toHaveTextContent('declined · 1 site still standing');
		expect(card).toHaveTextContent('splitting would hide the flow');
	});

	test('names an advisory the agent took without trailing an empty reason behind it', () => {
		setupStep({
			overrides: {
				report: {
					outcome: 'resolved',
					remainingSiteKeys: [],
					rationale: [],
					advisoryOutcomes: [{ rule: 'comment-narration', siteKey: 'src/a.ts:doThing', outcome: 'applied' }],
				},
			},
		});

		const rule = screen.getByText('comment-narration');

		expect(rule.parentElement).toHaveTextContent(/^comment-narration — applied$/);
	});

	test('leaves a batch that reported no rationale and no advisories without those headings', () => {
		setupStep({ overrides: { report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [] } } });

		const rationale = screen.queryByText('rationale');

		expect(rationale).not.toBeInTheDocument();
	});

	test('reads a writers envelope as how many batches ran and how they ended', () => {
		setupStep({
			overrides: {
				report: {
					reports: [
						{ status: 'complete', summary: 'covered the reader', changedFiles: [{ path: 'src/a.unit.test.ts', summary: 'new' }], failures: [] },
						{ status: 'complete', summary: 'covered the writer', changedFiles: [], failures: [] },
					],
				},
			},
		});

		const card = screen.getByRole('article');

		expect(card).toHaveTextContent('2 writer batches · 1 file · complete 2');
	});

	test("reads a working agent's report as what it changed and what fought it", () => {
		setupStep({
			overrides: {
				report: {
					status: 'failed',
					summary: 'the coverage gate would not pass',
					changedFiles: [{ path: 'src/a.unit.test.ts', summary: 'new cases' }],
					failures: ['statements still short of the bar'],
				},
			},
		});

		const card = screen.getByRole('article');

		expect(card).toHaveTextContent('src/a.unit.test.ts — new cases');
		expect(card).toHaveTextContent('statements still short of the bar');
	});

	test('leaves a clean work report without the changed-files and failures headings', () => {
		setupStep({ overrides: { report: { status: 'complete', summary: 'nothing needed changing', changedFiles: [] } } });

		const failures = screen.queryByText('failures');

		expect(failures).not.toBeInTheDocument();
	});

	test('shows a report matching no contract as the JSON the manifest holds', () => {
		setupStep({ overrides: { report: { shape: 'nobody anticipated' } } });

		const raw = screen.getByText(/"shape": "nobody anticipated"/);

		expect(raw).toBeInTheDocument();
	});
});
