import { describe, expect, jest, test } from '@jest/globals';
import type { RunBurnDown, RunBurnDownBatch } from '@lightsout/engine';
import { PipelineKind, RunBurnDownBatchOutcome } from '@lightsout/engine/contracts';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunDetail } from '#src/features/runDetail/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
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

/** One row of a refactor run's work-list, over a batch the agent resolved with nothing to say about it. */
const buildBatch = ({ overrides = {} }: { overrides?: Partial<RunBurnDownBatch> } = {}): RunBurnDownBatch => ({
	id: 'batch-01:size-file:src/views',
	rule: 'size-file',
	folder: 'src/views',
	blocking: 3,
	outcome: RunBurnDownBatchOutcome.Resolved,
	rationale: [],
	advisoryOutcomes: [],
	...overrides,
});

const setupBurnDown = ({ pipeline = PipelineKind.Refactor, burnDown }: { pipeline?: string; burnDown?: RunBurnDown } = {}) => {
	jest.useFakeTimers();

	// No tab is chosen: the burn-down sits on the overview, which is what the
	// page opens on.
	renderWithQueryClient({
		ui: <RunDetail runId={runId} />,
		seed: [
			{ queryKey: [QueryKey.Run, runId], data: buildRunView({ overrides: { listing: { ...buildRunListing(), pipeline }, burnDown } }) },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: '/repos/lightsout' } },
		],
	});
};

describe('RunDetail burn-down', () => {
	test('counts the sites a refactor run froze against the ones it left standing', () => {
		setupBurnDown({ burnDown: { before: 12, after: 4, batchesResolved: 2, batchesDeclined: 1, batches: [] } });

		const headline = screen.getByText('12 → 4 sites · 2 resolved · 1 declined');

		expect(headline).toBeInTheDocument();
	});

	test('reads a run that recorded no batch verdicts as none of either, rather than leaving a gap', () => {
		setupBurnDown({ burnDown: { before: 5, after: 5, batches: [] } });

		const headline = screen.getByText('5 → 5 sites · 0 resolved · 0 declined');

		expect(headline).toBeInTheDocument();
	});

	test('reports the sprawl the run measured when it counted any', () => {
		setupBurnDown({ burnDown: { before: 12, after: 4, batches: [], overCap: { before: 9, after: 2 } } });

		const overCap = screen.getByText('files over cap: 9 → 2');

		expect(overCap).toBeInTheDocument();
	});

	test('leaves the over-cap line out for a run whose rules counted no files', () => {
		setupBurnDown({ burnDown: { before: 12, after: 4, batches: [] } });

		const overCap = screen.queryByText(/files over cap/);

		expect(overCap).not.toBeInTheDocument();
	});

	test('says what one batch was given and how it ended', () => {
		setupBurnDown({ burnDown: { before: 3, after: 0, batches: [buildBatch({ overrides: { rule: 'size-function', folder: 'src/views', blocking: 3 } })] } });

		const rule = screen.getByText('size-function');

		expect(rule.parentElement).toHaveTextContent(/size-function.*src\/views.*3 sites.*resolved/);
	});

	test('shows the agent’s own account of a batch it declined', () => {
		setupBurnDown({
			burnDown: {
				before: 3,
				after: 3,
				batches: [buildBatch({ overrides: { outcome: RunBurnDownBatchOutcome.Declined, rationale: ['splitting would hide the flow'] } })],
			},
		});

		const rationale = screen.getByText('splitting would hide the flow');

		expect(rationale).toBeInTheDocument();
		expect(screen.getByText('declined')).toBeInTheDocument();
	});

	test('marks a batch the run never reached as not run', () => {
		setupBurnDown({ burnDown: { before: 3, after: 3, batches: [buildBatch({ overrides: { outcome: RunBurnDownBatchOutcome.NotRun } })] } });

		const outcome = screen.getByText('not run');

		expect(outcome).toBeInTheDocument();
	});

	test('names an advisory the batch declined and the reason it gave', () => {
		setupBurnDown({
			burnDown: {
				before: 3,
				after: 0,
				batches: [
					buildBatch({
						overrides: {
							advisoryOutcomes: [{ rule: 'comment-narration', siteKey: 'src/a.ts:doThing', outcome: 'declined', reason: 'the comment is the only note' }],
						},
					}),
				],
			},
		});

		const advisory = screen.getByText('comment-narration');

		expect(advisory.parentElement).toHaveTextContent(/^comment-narration — declined · the comment is the only note$/);
	});

	test('trails no empty reason behind an advisory that recorded none', () => {
		setupBurnDown({
			burnDown: {
				before: 3,
				after: 0,
				batches: [buildBatch({ overrides: { advisoryOutcomes: [{ rule: 'comment-narration', siteKey: 'src/a.ts:doThing', outcome: 'applied' }] } })],
			},
		});

		const advisory = screen.getByText('comment-narration');

		expect(advisory.parentElement).toHaveTextContent(/^comment-narration — applied$/);
	});

	test('counts the files a coverage run raised, and shows the ground each gained', () => {
		setupBurnDown({
			pipeline: PipelineKind.Coverage,
			burnDown: {
				batches: [],
				files: [
					{ path: 'src/a.ts', beforePct: 40, afterPct: 90 },
					{ path: 'src/b.ts', beforePct: 80, afterPct: 80 },
				],
			},
		});

		const raised = screen.getByText('1 file raised');

		expect(raised).toBeInTheDocument();
		expect(screen.getByText('40% → 90%')).toBeInTheDocument();
		expect(screen.getByText('80% → 80%')).toBeInTheDocument();
	});

	test('says a coverage run raised nothing rather than drawing an empty table', () => {
		setupBurnDown({ pipeline: PipelineKind.Coverage, burnDown: { batches: [] } });

		const raised = screen.getByText('0 files raised');

		expect(raised).toBeInTheDocument();
	});

	test('draws no burn-down at all for a run that burned nothing down', () => {
		setupBurnDown({ pipeline: PipelineKind.Implement });

		const panel = screen.queryByRole('heading', { level: 2, name: 'Burn-down' });

		expect(panel).not.toBeInTheDocument();
	});
});
