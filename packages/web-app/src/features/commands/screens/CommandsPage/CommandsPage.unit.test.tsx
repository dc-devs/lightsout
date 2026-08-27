import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry } from '@lightsout/engine';
import { CommandGroup, CommandRecordKind } from '@lightsout/engine/contracts';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { CommandsPage } from '#src/features/commands/index.ts';
import { buildCommandCatalogEntry } from '#tests/helpers/buildCommandCatalogEntry.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Each card's name is a link to that command's own page, and a link needs a
// live router to resolve a path. A plain anchor keeps the assertions about
// where the card points rather than about the routing library.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/**
 * `repoRoot` is seeded absent, which is the public build — the zone this page
 * has to render in, and the one where no card carries a count.
 */
const setupCommandsPage = ({ commands = [buildCommandCatalogEntry()] }: { commands?: CommandCatalogEntry[] } = {}) => {
	renderWithQueryClient({
		ui: <CommandsPage />,
		seed: [
			{ queryKey: [QueryKey.Commands], data: commands },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: undefined } },
		],
	});
};

/** The cards sitting under one group's heading, by the name each one is titled with. */
const readGroupCards = ({ heading }: { heading: string }): string[] => {
	const section = screen.getByRole('heading', { level: 2, name: heading }).closest('section');

	return Array.from(section?.querySelectorAll('article a') ?? []).map((link) => link.textContent ?? '');
};

describe('CommandsPage', () => {
	test('names the page and says what a reader will find on it', () => {
		setupCommandsPage();

		expect(screen.getByRole('heading', { level: 1, name: 'Commands' })).toBeInTheDocument();
		expect(screen.getByText(/Every command lightsout offers/)).toBeInTheDocument();
	});

	test('heads the four groups in the order a reader works through them, building before housekeeping', () => {
		setupCommandsPage();

		const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

		expect(headings).toStrictEqual(['Build', 'Burn down', 'Standards', 'Housekeeping']);
	});

	test('files each command under its own group rather than listing them all in one place', () => {
		setupCommandsPage({
			commands: [
				buildCommandCatalogEntry({ id: 'plan', slash: '/plan', group: CommandGroup.Build }),
				buildCommandCatalogEntry({ id: 'doctor', cli: 'lightsout doctor', group: CommandGroup.Housekeeping, overrides: { slash: undefined } }),
				buildCommandCatalogEntry({ id: 'refactor', slash: '/refactor', group: CommandGroup.BurnDown }),
			],
		});

		expect(readGroupCards({ heading: 'Build' })).toStrictEqual(['/plan']);
		expect(readGroupCards({ heading: 'Burn down' })).toStrictEqual(['/refactor']);
		expect(readGroupCards({ heading: 'Standards' })).toStrictEqual([]);
		expect(readGroupCards({ heading: 'Housekeeping' })).toStrictEqual(['lightsout doctor']);
	});

	test('keeps the catalog’s own order inside a group, so the page never re-sorts what the engine stated', () => {
		setupCommandsPage({
			commands: [
				buildCommandCatalogEntry({ id: 'plan', slash: '/plan', group: CommandGroup.Build }),
				buildCommandCatalogEntry({ id: 'brainstorm', slash: '/brainstorm', group: CommandGroup.Build }),
				buildCommandCatalogEntry({ id: 'implement', slash: '/implement', group: CommandGroup.Build }),
			],
		});

		const titles = readGroupCards({ heading: 'Build' });

		expect(titles).toStrictEqual(['/plan', '/brainstorm', '/implement']);
	});
});

describe('CommandsPage command cards', () => {
	test('titles a card with the slash form, which is what a reader with the plugin installed would type', () => {
		setupCommandsPage({ commands: [buildCommandCatalogEntry({ id: 'refactor', slash: '/refactor', cli: 'lightsout refactor' })] });

		const link = screen.getByRole('link', { name: '/refactor' });

		expect(link).toBeInTheDocument();
	});

	test('falls back to the CLI form for a command the plugin ships no skill for', () => {
		setupCommandsPage({ commands: [buildCommandCatalogEntry({ id: 'doctor', cli: 'lightsout doctor', overrides: { slash: undefined } })] });

		const link = screen.getByRole('link', { name: 'lightsout doctor' });

		expect(link).toBeInTheDocument();
	});

	test('points the title at that command’s own page, addressed by its catalog id rather than its title', () => {
		setupCommandsPage({ commands: [buildCommandCatalogEntry({ id: 'test-coverage-to-threshold', slash: '/test-coverage-to-threshold' })] });

		const link = screen.getByRole('link', { name: '/test-coverage-to-threshold' });

		expect(link).toHaveAttribute('href', '/commands/test-coverage-to-threshold');
	});

	test('prints the catalog’s one-line summary, so a reader can choose without opening the page', () => {
		setupCommandsPage({ commands: [buildCommandCatalogEntry({ summary: 'Pick a parked run back up where it stopped.' })] });

		const summary = screen.getByText('Pick a parked run back up where it stopped.');

		expect(summary).toBeInTheDocument();
	});

	test.each([
		{ records: CommandRecordKind.Runs, label: 'records runs' },
		{ records: CommandRecordKind.Plans, label: 'records plans' },
		{ records: CommandRecordKind.Snapshots, label: 'records snapshots' },
		{ records: CommandRecordKind.Nothing, label: 'records nothing' },
	])('badges a $records command as "$label", which is what it leaves behind', ({ records, label }) => {
		setupCommandsPage({ commands: [buildCommandCatalogEntry({ records })] });

		const badge = within(screen.getByRole('article')).getByText(label);

		expect(badge).toBeInTheDocument();
	});
});
