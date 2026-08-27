import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry, PlanWorkspaceListing, RunListing, StandardsView } from '@lightsout/engine';
import { CommandRecordKind, PipelineKind } from '@lightsout/engine/contracts';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { CommandsPage } from '#src/features/commands/index.ts';
import { buildCommandCatalogEntry } from '#tests/helpers/buildCommandCatalogEntry.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Only the card's title link, which needs a live router to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/**
 * One card, with the whole cache the count line can read seeded around it.
 *
 * `repoRoot` is passed rather than defaulted: an explicit `undefined` is the
 * public build, and that is the case a default parameter would swallow.
 */
const setupCommandCount = ({
	entry,
	repoRoot,
	runs = [],
	standards = buildStandardsView(),
	plans = [],
}: {
	entry: CommandCatalogEntry;
	repoRoot: string | undefined;
	runs?: RunListing[];
	standards?: StandardsView;
	plans?: PlanWorkspaceListing[];
}) => {
	renderWithQueryClient({
		ui: <CommandsPage />,
		seed: [
			{ queryKey: [QueryKey.Commands], data: [entry] },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
			{ queryKey: [QueryKey.Standards], data: standards },
			{ queryKey: [QueryKey.PlanWorkspaces], data: plans },
		],
	});
};

/** The card's second paragraph — its count line — or undefined when the card carries none. */
const readCountLine = (): string | undefined => Array.from(screen.getByRole('article').querySelectorAll('p'))[1]?.textContent ?? undefined;

describe('CommandsPage command counts', () => {
	test('says nothing about runs on a build with no repo, where the reader’s cache holds demo rows rather than theirs', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'refactor', records: CommandRecordKind.Runs }),
			repoRoot: undefined,
			runs: [buildRunListing({ pipeline: PipelineKind.Refactor })],
		});

		const line = readCountLine();

		expect(line).toBeUndefined();
	});

	test('counts only this command’s own runs once a repo is found, and says how long ago the newest was', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'refactor', records: CommandRecordKind.Runs }),
			repoRoot: '/repos/lightsout',
			runs: [
				buildRunListing({ runId: 'aaaa1111', pipeline: PipelineKind.Refactor }),
				buildRunListing({ runId: 'bbbb2222', pipeline: PipelineKind.Refactor }),
				buildRunListing({ runId: 'cccc3333', pipeline: PipelineKind.Coverage }),
			],
		});

		const line = readCountLine();

		expect(line).toMatch(/^2 runs · last .+ ago$/);
	});

	test('folds a coordinator’s phase children under it, so the card and the command’s own table print one number', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'implement', records: CommandRecordKind.Runs }),
			repoRoot: '/repos/lightsout',
			runs: [
				buildRunListing({ runId: 'aaaa1111', pipeline: PipelineKind.Phases }),
				buildRunListing({ runId: 'bbbb2222', pipeline: PipelineKind.Implement, parentRunId: 'aaaa1111' }),
				buildRunListing({ runId: 'cccc3333', pipeline: PipelineKind.Implement, parentRunId: 'aaaa1111' }),
			],
		});

		const line = readCountLine();

		expect(line).toMatch(/^1 run · last .+ ago$/);
	});

	test('says the command is available and unused rather than going blank when the repo has run it none', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'refactor', records: CommandRecordKind.Runs }),
			repoRoot: '/repos/lightsout',
			runs: [buildRunListing({ pipeline: PipelineKind.Coverage })],
		});

		const line = readCountLine();

		expect(line).toBe('no runs yet');
	});

	test('counts nothing for a command whose work is recorded under the command it resumed', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'resume', records: CommandRecordKind.Runs, overrides: { slash: undefined } }),
			repoRoot: '/repos/lightsout',
			runs: [buildRunListing({ pipeline: PipelineKind.Implement })],
		});

		const line = readCountLine();

		expect(line).toBeUndefined();
	});

	test('counts nothing for a command the run-value map has no entry for at all', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'a-command-from-a-newer-engine', records: CommandRecordKind.Runs }),
			repoRoot: '/repos/lightsout',
			runs: [buildRunListing({ pipeline: PipelineKind.Implement })],
		});

		const line = readCountLine();

		expect(line).toBeUndefined();
	});

	test('counts the checks a repo has recorded, and when the last one ran', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'standards-check', records: CommandRecordKind.Snapshots }),
			repoRoot: '/repos/lightsout',
			standards: buildStandardsView({
				overrides: {
					trend: [
						{ at: '2026-01-01T00:00:00.000Z', path: '.', total: 9, blocking: 4, advisory: 5, byRule: [] },
						{ at: '2026-02-01T00:00:00.000Z', path: '.', total: 6, blocking: 2, advisory: 4, byRule: [] },
					],
				},
			}),
		});

		const line = readCountLine();

		expect(line).toMatch(/^2 snapshots · last .+ ago$/);
	});

	test('says no snapshots yet in a repo that has never run a check, where the view carries no date either', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'standards-check', records: CommandRecordKind.Snapshots }),
			repoRoot: '/repos/lightsout',
			standards: buildStandardsView({ overrides: { at: undefined, trend: [] } }),
		});

		const line = readCountLine();

		expect(line).toBe('no snapshots yet');
	});

	test('counts the plans /plan drafted, which is the same subset its own history table lists', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'plan', records: CommandRecordKind.Plans }),
			repoRoot: '/repos/lightsout',
			plans: [
				buildPlanWorkspaceListing({ name: 'drafted', hasPlanFile: true }),
				buildPlanWorkspaceListing({ name: 'notes-only', hasPlanFile: false, hasNotes: true }),
			],
		});

		const line = readCountLine();

		// a workspace with notes and no draft is not something /plan has produced
		expect(line).toMatch(/^1 plan · last .+ ago$/);
	});

	test('counts notes rather than plans on the /brainstorm card, since that is what sits above its table', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'brainstorm', records: CommandRecordKind.Plans }),
			repoRoot: '/repos/lightsout',
			plans: [
				buildPlanWorkspaceListing({ name: 'drafted', hasPlanFile: true }),
				buildPlanWorkspaceListing({ name: 'notes-only', hasPlanFile: false, hasNotes: true }),
			],
		});

		expect(readCountLine()).toMatch(/^1 note · last .+ ago$/);
	});

	test('says no plans yet in a repo whose workspaces none of them drafted', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'plan', records: CommandRecordKind.Plans }),
			repoRoot: '/repos/lightsout',
			plans: [buildPlanWorkspaceListing({ name: 'notes-only', hasPlanFile: false, hasNotes: true })],
		});

		expect(readCountLine()).toBe('no plans yet');
	});

	test('says nothing about plans on a build with no repo, where a visitor has none of their own', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'plan', records: CommandRecordKind.Plans }),
			repoRoot: undefined,
			plans: [buildPlanWorkspaceListing()],
		});

		expect(readCountLine()).toBeUndefined();
	});

	test('carries no count line when the command leaves nothing behind to count', () => {
		setupCommandCount({
			entry: buildCommandCatalogEntry({ id: 'doctor', records: CommandRecordKind.Nothing }),
			repoRoot: '/repos/lightsout',
			runs: [buildRunListing({ pipeline: PipelineKind.Implement })],
		});

		const line = readCountLine();

		expect(line).toBeUndefined();
	});
});
