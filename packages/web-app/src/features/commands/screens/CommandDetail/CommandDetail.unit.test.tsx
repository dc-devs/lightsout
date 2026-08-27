import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry } from '@lightsout/engine';
import { CommandRecordKind } from '@lightsout/engine/contracts';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { CommandDetail } from '#src/features/commands/index.ts';
import { buildCommandCatalogEntry } from '#tests/helpers/buildCommandCatalogEntry.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The breadcrumb and every related-command link need a live router to resolve a
// path. A plain anchor keeps the assertions about where the page points rather
// than about the routing library.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/**
 * The page over a catalog of one, with no repo under it — the manual half is
 * what a reader arriving from a link sees, and it has to render without one.
 */
const setupCommandDetail = ({ entry = buildCommandCatalogEntry(), commandId = entry.id }: { entry?: CommandCatalogEntry; commandId?: string } = {}) => {
	renderWithQueryClient({
		ui: <CommandDetail commandId={commandId} />,
		seed: [
			{ queryKey: [QueryKey.Commands], data: [entry] },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: undefined } },
		],
	});
};

describe('CommandDetail', () => {
	test('renders nothing at all for an id the catalog does not carry, leaving the answer to the route’s own panel', () => {
		setupCommandDetail({ commandId: 'not-a-command' });

		expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
		expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
	});

	test('trails back to the commands list, with this command as the page already open', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ id: 'standards-check' }) });
		const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });

		expect(within(crumbs).getByRole('link', { name: 'Commands' })).toHaveAttribute('href', '/commands');
		expect(within(crumbs).getByText('standards-check')).toHaveAttribute('aria-current', 'page');
	});

	test('heads the page with the slash form, which is what a reader with the plugin installed would type', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ slash: '/refactor', cli: 'lightsout refactor' }) });

		const heading = screen.getByRole('heading', { level: 1, name: '/refactor' });

		expect(heading).toBeInTheDocument();
	});

	test('heads it with the CLI form instead for a command the plugin ships no skill for', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ cli: 'lightsout doctor', overrides: { slash: undefined } }) });

		const heading = screen.getByRole('heading', { level: 1, name: 'lightsout doctor' });

		expect(heading).toBeInTheDocument();
	});

	test('falls back to the bare id when a command has neither form to print', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ id: 'brainstorm', overrides: { slash: undefined, cli: undefined } }) });

		const heading = screen.getByRole('heading', { level: 1, name: 'brainstorm' });

		expect(heading).toBeInTheDocument();
	});

	test('prints the catalog’s one-line summary under the name', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ summary: 'Burn down the findings nobody will fix by hand.' }) });

		const summary = screen.getByText('Burn down the findings nobody will fix by hand.');

		expect(summary).toBeInTheDocument();
	});

	test('badges what the command leaves behind, in the same words its card uses', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ records: CommandRecordKind.Snapshots }) });

		const badge = screen.getByText('records snapshots');

		expect(badge).toBeInTheDocument();
	});

	test('tags both ways of invoking a command that has a skill and a command word', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ slash: '/implement', cli: 'lightsout implement' }) });

		const tags = Array.from(document.querySelectorAll('span.font-mono')).map((tag) => tag.textContent);

		expect(tags).toStrictEqual(['/implement', 'lightsout implement']);
	});

	test('tags only the command word when the plugin ships no skill for it', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ cli: 'lightsout doctor', overrides: { slash: undefined } }) });

		const tags = Array.from(document.querySelectorAll('span.font-mono')).map((tag) => tag.textContent);

		expect(tags).toStrictEqual(['lightsout doctor']);
	});

	test('answers when to reach for the command in the catalog’s own paragraph', () => {
		setupCommandDetail({
			entry: buildCommandCatalogEntry({ whenToUse: 'Use it when the coverage gate is what stands between you and a green build.' }),
		});

		expect(screen.getByRole('heading', { level: 2, name: 'When to reach for it' })).toBeInTheDocument();
		expect(screen.getByText('Use it when the coverage gate is what stands between you and a green build.')).toBeInTheDocument();
	});

	test('points at every command the catalog relates this one to, by id', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ related: ['plan', 'resume'] }) });
		const card = screen.getByRole('heading', { level: 2, name: 'Related commands' }).closest('section');

		const hrefs = Array.from(card?.querySelectorAll('a') ?? []).map((link) => link.getAttribute('href'));

		expect(hrefs).toStrictEqual(['/commands/plan', '/commands/resume']);
	});

	test('leaves the related card off entirely for a command the catalog relates to none', () => {
		setupCommandDetail({ entry: buildCommandCatalogEntry({ related: [] }) });

		const card = screen.queryByRole('heading', { level: 2, name: 'Related commands' });

		expect(card).not.toBeInTheDocument();
	});
});
