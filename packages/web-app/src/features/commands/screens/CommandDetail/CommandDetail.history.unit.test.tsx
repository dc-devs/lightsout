import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry, PlanWorkspaceListing, RunListing, RunView, StandardsView } from '@lightsout/engine';
import { CommandRecordKind, PipelineKind } from '@lightsout/engine/contracts';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { CommandDetail } from '#src/features/commands/index.ts';
import { buildCommandCatalogEntry } from '#tests/helpers/buildCommandCatalogEntry.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildRunView } from '#tests/helpers/buildRunView.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The breadcrumb, the related links and every run title in the table need a
// live router to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/**
 * The page with a repo under it, and every view its history section can read
 * seeded — the runs list, the standards snapshots, and one loaded run per
 * burn-down row.
 *
 * `found` rather than a repo path, because the only thing this section reads
 * from that query is whether there is a repo at all — and a default parameter
 * would swallow the explicit `undefined` that spells the public build.
 */
const setupCommandHistory = ({
	entry,
	found = true,
	runs = [],
	views = [],
	standards = buildStandardsView(),
	plans = [],
}: {
	entry: CommandCatalogEntry;
	/** Whether the app has a repo open; false is the public build. */
	found?: boolean;
	runs?: RunListing[];
	views?: RunView[];
	standards?: StandardsView;
	plans?: PlanWorkspaceListing[];
}) => {
	renderWithQueryClient({
		ui: <CommandDetail commandId={entry.id} />,
		seed: [
			{ queryKey: [QueryKey.Commands], data: [entry] },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: found ? '/repos/lightsout' : undefined } },
			{ queryKey: [QueryKey.Runs], data: runs },
			{ queryKey: [QueryKey.Standards], data: standards },
			{ queryKey: [QueryKey.PlanWorkspaces], data: plans },
			...views.map((view) => ({ queryKey: [QueryKey.Run, view.listing.runId], data: view })),
		],
	});
};

/** A refactor run's listing and its loaded view, which is where the burn-down numbers live. */
const buildRefactorRun = ({ runId, title, before, after }: { runId: string; title: string; before: number; after: number }) => {
	const listing = buildRunListing({ runId, title, pipeline: PipelineKind.Refactor });

	return {
		listing,
		view: buildRunView({ overrides: { listing, burnDown: { before, after, batchesResolved: 3, batchesDeclined: 1, batches: [] } } }),
	};
};

/** Every line of the before-and-after strip, without the run id each one is tagged with. */
const readStripLines = (): string[] => {
	const card = screen.getByRole('heading', { level: 2, name: 'Measured before and after' }).closest('section');

	return Array.from(card?.querySelectorAll('p span:not(.font-mono)') ?? []).map((line) => line.textContent ?? '');
};

describe('CommandDetail history', () => {
	test('shows no history at all on a build with no repo, where the reader’s cache holds demo runs rather than theirs', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'implement', records: CommandRecordKind.Runs }),
			found: false,
			runs: [buildRunListing({ title: 'add search' })],
		});

		expect(screen.queryByRole('heading', { level: 2, name: 'In this repo' })).not.toBeInTheDocument();
		expect(screen.queryByText('add search')).not.toBeInTheDocument();
	});

	test('lists only this command’s own runs once a repo is found', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'implement', records: CommandRecordKind.Runs }),
			runs: [
				buildRunListing({ runId: 'aaaa1111', title: 'add search', pipeline: PipelineKind.Implement }),
				buildRunListing({ runId: 'bbbb2222', title: 'burn down duplication', pipeline: PipelineKind.Refactor }),
			],
		});
		const card = screen.getByRole('heading', { level: 2, name: 'In this repo' }).closest('section');

		const titles = Array.from(card?.querySelectorAll('tbody a') ?? []).map((link) => link.textContent);

		expect(titles).toStrictEqual(['add search']);
	});

	test('says where a resumed run is recorded instead of showing a table it would never fill', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'resume', records: CommandRecordKind.Runs, overrides: { slash: undefined } }),
			runs: [buildRunListing({ title: 'add search', pipeline: PipelineKind.Implement })],
		});

		expect(screen.getByText('Resumed runs appear under the command they resumed.')).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});

	test('says the same thing for a command the run-value map has no entry for at all', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'a-command-from-a-newer-engine', records: CommandRecordKind.Runs }),
			runs: [buildRunListing({ title: 'add search', pipeline: PipelineKind.Implement })],
		});

		expect(screen.getByText('Resumed runs appear under the command they resumed.')).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});

	test('leaves the table in its newest-first order when a reader presses a column, since these filters are fixed', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'implement', records: CommandRecordKind.Runs }),
			runs: [
				buildRunListing({ runId: 'aaaa1111', title: 'add search', pipeline: PipelineKind.Implement }),
				buildRunListing({ runId: 'bbbb2222', title: 'a rename', pipeline: PipelineKind.Implement }),
			],
		});

		fireEvent.click(screen.getByRole('button', { name: 'run' }));
		const titles = Array.from(document.querySelectorAll('tbody a')).map((link) => link.textContent);

		expect(titles).toStrictEqual(['add search', 'a rename']);
	});

	test('draws no before-and-after strip for a command that burns nothing down', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'implement', records: CommandRecordKind.Runs }),
			runs: [buildRunListing({ pipeline: PipelineKind.Implement })],
			views: [buildRunView()],
		});

		const strip = screen.queryByRole('heading', { level: 2, name: 'Measured before and after' });

		expect(strip).not.toBeInTheDocument();
	});

	test('reports what each refactor run burned down and how its batches ended', () => {
		const first = buildRefactorRun({ runId: 'aaaa1111', title: 'burn down duplication', before: 40, after: 12 });
		const second = buildRefactorRun({ runId: 'bbbb2222', title: 'burn down size', before: 12, after: 5 });
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'refactor', records: CommandRecordKind.Runs }),
			runs: [first.listing, second.listing],
			views: [first.view, second.view],
		});

		const lines = readStripLines();

		expect(lines).toStrictEqual(['40 → 12 findings · 3 resolved, 1 declined', '12 → 5 findings · 3 resolved, 1 declined']);
	});

	test('reads a refactor run whose burn-down recorded no counts as zeros rather than blanks', () => {
		const listing = buildRunListing({ runId: 'aaaa1111', pipeline: PipelineKind.Refactor });
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'refactor', records: CommandRecordKind.Runs }),
			runs: [listing],
			views: [buildRunView({ overrides: { listing, burnDown: { batches: [] } } })],
		});

		const lines = readStripLines();

		expect(lines).toStrictEqual(['0 → 0 findings · 0 resolved, 0 declined']);
	});

	test('reads a coverage run by its worst file’s percentages, since that is the one the gate turns on', () => {
		const listing = buildRunListing({ runId: 'aaaa1111', pipeline: PipelineKind.Coverage });
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'test-coverage-to-threshold', records: CommandRecordKind.Runs }),
			runs: [listing],
			views: [
				buildRunView({
					overrides: {
						listing,
						burnDown: {
							batches: [],
							files: [
								{ path: 'src/parse.ts', beforePct: 41, afterPct: 96 },
								{ path: 'src/render.ts', beforePct: 80, afterPct: 97 },
							],
						},
					},
				}),
			],
		});

		const lines = readStripLines();

		expect(lines).toStrictEqual(['2 files · worst src/parse.ts 41% → 96%']);
	});

	test('says plainly that a coverage run measured nothing rather than printing an empty percentage', () => {
		const listing = buildRunListing({ runId: 'aaaa1111', pipeline: PipelineKind.Coverage });
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'test-coverage-to-threshold', records: CommandRecordKind.Runs }),
			runs: [listing],
			views: [buildRunView({ overrides: { listing, burnDown: { batches: [], files: [] } } })],
		});

		const lines = readStripLines();

		expect(lines).toStrictEqual(['no files measured']);
	});

	test('leaves the strip off when no loaded run has a burn-down yet, keeping the table on its own', () => {
		const listing = buildRunListing({ runId: 'aaaa1111', pipeline: PipelineKind.Refactor });
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'refactor', records: CommandRecordKind.Runs }),
			runs: [listing],
			views: [buildRunView({ overrides: { listing } })],
		});

		expect(screen.queryByRole('heading', { level: 2, name: 'Measured before and after' })).not.toBeInTheDocument();
		expect(screen.getByRole('table')).toBeInTheDocument();
	});

	test('loads five runs at most for the strip, and says out loud that is what it did', () => {
		const loaded = ['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444', 'eeee5555'].map((runId, index) =>
			buildRefactorRun({ runId, title: `burn down ${index}`, before: 40, after: 12 }),
		);
		const sixth = buildRunListing({ runId: 'ffff6666', title: 'burn down 5', pipeline: PipelineKind.Refactor });
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'refactor', records: CommandRecordKind.Runs }),
			runs: [...loaded.map(({ listing }) => listing), sixth],
			views: loaded.map(({ view }) => view),
		});

		expect(readStripLines()).toHaveLength(5);
		expect(screen.getByText('The 5 most recent runs of this command.')).toBeInTheDocument();
	});

	test('counts the checks this repo has recorded, and when the last one ran', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'standards-check', records: CommandRecordKind.Snapshots }),
			standards: buildStandardsView({
				overrides: {
					trend: [
						{ at: '2026-01-01T00:00:00.000Z', path: '.', total: 9, blocking: 4, advisory: 5, byRule: [] },
						{ at: '2026-02-01T00:00:00.000Z', path: '.', total: 6, blocking: 2, advisory: 4, byRule: [] },
					],
				},
			}),
		});
		const card = screen.getByRole('heading', { level: 2, name: 'In this repo' }).closest('section');

		expect(card?.textContent).toMatch(/2 snapshots recorded · last .+ ago\./);
	});

	test('says no check has run here yet rather than reporting zero snapshots as a number', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'standards-check', records: CommandRecordKind.Snapshots }),
			standards: buildStandardsView({ overrides: { at: undefined, trend: [] } }),
		});

		const line = screen.getByText('No standards check has run in this repo yet.');

		expect(line).toBeInTheDocument();
	});

	test('lists the workspaces /plan drafted, and leaves out the ones it never wrote a plan file for', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'plan', records: CommandRecordKind.Plans }),
			plans: [
				buildPlanWorkspaceListing({ name: 'drafted', hasPlanFile: true }),
				buildPlanWorkspaceListing({ name: 'notes-only', hasPlanFile: false, hasNotes: true }),
			],
		});

		expect(screen.getByRole('link', { name: 'drafted' })).toHaveAttribute('href', '/repo/plans/drafted');
		expect(screen.queryByRole('link', { name: 'notes-only' })).not.toBeInTheDocument();
	});

	test('lists the workspaces /brainstorm wrote notes for instead, which is a different subset of the same list', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'brainstorm', records: CommandRecordKind.Plans }),
			plans: [
				buildPlanWorkspaceListing({ name: 'drafted', hasPlanFile: true }),
				buildPlanWorkspaceListing({ name: 'notes-only', hasPlanFile: false, hasNotes: true }),
			],
		});

		expect(screen.getByRole('link', { name: 'notes-only' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'drafted' })).not.toBeInTheDocument();
	});

	test('says a repo has no drafted plans rather than showing an empty table, and says it in that command’s own words', () => {
		setupCommandHistory({
			entry: buildCommandCatalogEntry({ id: 'brainstorm', records: CommandRecordKind.Plans }),
			plans: [buildPlanWorkspaceListing({ name: 'drafted', hasPlanFile: true })],
		});

		// 'no plans yet' would be false here: this repo has one
		expect(screen.getByText('No brainstorm notes yet.')).toBeInTheDocument();
	});

	test('says a command that leaves nothing behind records nothing, rather than showing an empty table', () => {
		setupCommandHistory({ entry: buildCommandCatalogEntry({ id: 'doctor', records: CommandRecordKind.Nothing }) });

		expect(screen.getByText('This command records nothing.')).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});
});
