import { describe, expect, jest, test } from '@jest/globals';
import type { RunView } from '@lightsout/engine';
import { screen } from '@testing-library/react';
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

const runId = 'abcdef0123456789';

const setupFriction = ({ overrides = {} }: { overrides?: Partial<RunView> } = {}) => {
	jest.useFakeTimers();
	renderWithQueryClient({ ui: <RunDetail runId={runId} />, seed: [{ queryKey: [QueryKey.Run, runId], data: buildRunView({ overrides }) }] });
};

describe('RunDetail friction and changed files', () => {
	test('says a run reported no friction rather than showing an empty panel', () => {
		setupFriction();

		const none = screen.getByText('This run reported no friction.');

		expect(none).toBeInTheDocument();
	});

	test('gathers what fought the agents under the area each entry named, with a count', () => {
		setupFriction({
			overrides: {
				friction: [
					{ kind: 'friction', area: 'plan', detail: 'the plan named a file that is not on disk', at: '2026-01-01T00:01:00.000Z', runId, step: 'implement' },
					{ kind: 'decision', area: 'plan', detail: 'chose the narrower barrel', at: '2026-01-01T00:02:00.000Z', runId, step: 'implement' },
					{ area: 'environment', detail: 'the coverage report was stale', at: '2026-01-01T00:03:00.000Z', runId, step: 'write-tests' },
				],
			},
		});

		const areas = screen.getAllByText(/^(plan|environment) · \d+$/);

		expect(areas.map((area) => area.textContent)).toStrictEqual(['plan · 2', 'environment · 1']);
	});

	test('reads an entry that named no kind as friction, which is what an omitted kind means', () => {
		setupFriction({
			overrides: { friction: [{ area: 'other', detail: 'the coverage report was stale', at: '2026-01-01T00:03:00.000Z', runId, step: 'write-tests' }] },
		});

		const entry = screen.getByText('the coverage report was stale').previousElementSibling;

		expect(entry).toHaveTextContent('friction · write-tests');
	});

	test('says a run changed nothing rather than showing an empty list', () => {
		setupFriction();

		const none = screen.getByText('This run changed nothing.');

		expect(none).toBeInTheDocument();
	});

	test('groups the changed files by area, so the blast radius reads by package first', () => {
		setupFriction({ overrides: { changedFiles: ['packages/engine/src/a.ts', 'packages/engine/src/b.ts', 'packages/web-app/src/c.tsx'] } });

		const areas = screen.getAllByText(/^packages\/(engine|web-app)$/);

		expect(areas.map((area) => area.textContent)).toStrictEqual(['packages/engine', 'packages/web-app']);
	});

	test('counts the changed files in the panel heading', () => {
		setupFriction({ overrides: { changedFiles: ['packages/engine/src/a.ts', 'packages/engine/src/b.ts'] } });

		const heading = screen.getByRole('heading', { name: 'Changed files · 2' });

		expect(heading).toBeInTheDocument();
	});

	test('calls out the files no public surface reaches, since no test covers them', () => {
		setupFriction({ overrides: { changedFiles: ['packages/engine/src/a.ts'], unreachableChangedFiles: ['packages/engine/src/a.ts'] } });

		const warning = screen.getByText(/no public surface reaches them/);

		expect(warning).toBeInTheDocument();
	});
});
