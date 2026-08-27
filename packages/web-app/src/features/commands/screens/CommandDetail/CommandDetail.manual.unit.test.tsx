import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry } from '@lightsout/engine';
import { CommandActor } from '@lightsout/engine/contracts';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { CommandDetail } from '#src/features/commands/index.ts';
import { buildCommandCatalogEntry } from '#tests/helpers/buildCommandCatalogEntry.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Only the breadcrumb and related links, which need a live router to resolve a
// path — nothing this file asserts on.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/** The manual over one entry, with no repo under it, so nothing but the manual is on the page. */
const setupCommandManual = ({ entry }: { entry: CommandCatalogEntry }) => {
	renderWithQueryClient({
		ui: <CommandDetail commandId={entry.id} />,
		seed: [
			{ queryKey: [QueryKey.Commands], data: [entry] },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: undefined } },
		],
	});
};

/** Every row of the flag table, cell by cell, as a reader reads across it. */
const readFlagRows = (): string[][] =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) =>
			within(row)
				.getAllByRole('cell')
				.map((cell) => cell.textContent ?? ''),
		);

describe('CommandDetail invocations', () => {
	test('leaves the how-to-run card off a command with no invocation shape to show', () => {
		setupCommandManual({ entry: buildCommandCatalogEntry({ overrides: { invocations: [] } }) });

		const card = screen.queryByRole('heading', { level: 2, name: 'How to run it' });

		expect(card).not.toBeInTheDocument();
	});

	test('spells one line per shape — the command word, then the words that follow it', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				cli: 'lightsout plan',
				overrides: { invocations: [{ id: 'draft', positional: 'draft' }, { id: 'fresh' }] },
			}),
		});
		const card = screen.getByRole('heading', { level: 2, name: 'How to run it' }).closest('section');

		const lines = Array.from(card?.querySelectorAll('code') ?? []).map((line) => line.textContent);

		expect(lines).toStrictEqual(['lightsout plan draft', 'lightsout plan']);
	});

	test('glosses a shape whose purpose the command word does not give away', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: { invocations: [{ id: 'resume', positional: undefined, note: 'resume a stopped burn-down' }] },
			}),
		});

		const note = screen.getByText('resume a stopped burn-down');

		expect(note).toBeInTheDocument();
	});

	test('heads the flag table with what to type, what it means, and what leaving it out does', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: { invocations: [{ id: 'fresh' }], flags: [{ name: 'cwd', value: '<path>', meaning: 'Repository to work in.', required: false }] },
			}),
		});

		const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);

		expect(headers).toStrictEqual(['flag', 'meaning', 'left out']);
	});

	test('spells a flag with its placeholder, and a boolean flag as the bare word', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: {
					invocations: [{ id: 'fresh' }],
					flags: [
						{ name: 'max-batches', value: '<n>', meaning: 'Stop after this many batches.', fallback: 'no ceiling', required: false },
						{ name: 'allow-dirty', meaning: 'Run against a tree with uncommitted work.', required: false },
					],
				},
			}),
		});

		const rows = readFlagRows();

		expect(rows).toStrictEqual([
			['--max-batches <n>', 'Stop after this many batches.', 'no ceiling'],
			['--allow-dirty', 'Run against a tree with uncommitted work.', 'off'],
		]);
	});

	test('says a flag is required rather than inventing a default it does not have', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: { invocations: [{ id: 'fresh' }], flags: [{ name: 'run', value: '<id>', meaning: 'The run to pick back up.', required: true }] },
			}),
		});

		const rows = readFlagRows();

		expect(rows).toStrictEqual([['--run <id>', 'The run to pick back up.', 'required']]);
	});

	test('lists one row per shape for a flag whose placeholder differs between them, rather than collapsing the two', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: {
					invocations: [{ id: 'single' }, { id: 'folder' }],
					flags: [
						{ name: 'plan', value: '<path>', meaning: 'One graded plan.', shape: 'single', required: false },
						{ name: 'plan', value: '<folder>', meaning: 'A folder of phase plans.', shape: 'folder', required: false },
					],
				},
			}),
		});

		const rows = readFlagRows();

		expect(rows).toStrictEqual([
			['--plan <path>', 'One graded plan.', 'off'],
			['--plan <folder>', 'A folder of phase plans.', 'off'],
		]);
	});

	test('shows the shapes without a table for a command that takes no flags at all', () => {
		setupCommandManual({ entry: buildCommandCatalogEntry({ overrides: { invocations: [{ id: 'fresh' }], flags: [] } }) });

		expect(screen.getByRole('heading', { level: 2, name: 'How to run it' })).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});
});

describe('CommandDetail steps', () => {
	test('leaves the what-happens card off a command with no sequence worth drawing', () => {
		setupCommandManual({ entry: buildCommandCatalogEntry({ overrides: { steps: [] } }) });

		const card = screen.queryByRole('heading', { level: 2, name: 'What happens' });

		expect(card).not.toBeInTheDocument();
	});

	test('numbers the steps in catalog order, so a reader can follow the sequence rather than guess it', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: {
					steps: [
						{ title: 'START THE RUN', actor: CommandActor.Engine, bullets: ['Create a run id'], saved: [] },
						{ title: 'READ THE PLAN', actor: CommandActor.Agent, bullets: ['Read every step'], saved: [] },
					],
				},
			}),
		});

		const titles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

		expect(titles).toStrictEqual(['When to reach for it', 'What happens', '1. START THE RUN', '2. READ THE PLAN']);
	});

	test('names who does each step, which is what the infographic draws as its tag', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: { steps: [{ title: 'DECIDE THE SCOPE', actor: CommandActor.You, bullets: ['Pick the packages'], saved: [] }] },
			}),
		});

		const actor = screen.getByText('you decide');

		expect(actor).toBeInTheDocument();
	});

	test('lists a step’s bullets and the italic line saying what the step prevents', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: {
					steps: [
						{
							title: 'GATE THE STEP',
							actor: CommandActor.Engine,
							bullets: ['Run the repo’s own tests', 'Run lint and types'],
							note: 'Stops a green claim over a red build.',
							saved: [],
						},
					],
				},
			}),
		});

		const bullets = screen.getAllByRole('listitem').map((item) => item.textContent);

		expect(bullets).toStrictEqual(['Run the repo’s own tests', 'Run lint and types']);
		expect(screen.getByText('Stops a green claim over a red build.')).toBeInTheDocument();
	});

	test('names the files a step writes under a plain "writes" label', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: {
					steps: [
						{
							title: 'FREEZE THE MANIFEST',
							actor: CommandActor.Engine,
							bullets: ['Write the work list'],
							saved: ['.lightsout/runs/<id>/manifest.json', '.lightsout/runs/<id>/report.md'],
						},
					],
				},
			}),
		});
		const line = screen.getByText('writes').closest('p');

		const paths = Array.from(line?.querySelectorAll('span.font-mono') ?? []).map((tag) => tag.textContent);

		expect(paths).toStrictEqual(['.lightsout/runs/<id>/manifest.json', '.lightsout/runs/<id>/report.md']);
	});

	test('uses a step’s own label in place of that one where the catalog states one', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: {
					steps: [{ title: 'HAND IT BACK', actor: CommandActor.Agent, bullets: ['Report what changed'], saved: ['report.md'], savedLabel: 'HANDED BACK' }],
				},
			}),
		});

		expect(screen.getByText('HANDED BACK')).toBeInTheDocument();
		expect(screen.queryByText('writes')).not.toBeInTheDocument();
	});

	test('draws no writes line at all for a step that leaves nothing behind', () => {
		setupCommandManual({
			entry: buildCommandCatalogEntry({
				overrides: { steps: [{ title: 'ASK THE QUESTIONS', actor: CommandActor.You, bullets: ['Answer the interview'], saved: [] }] },
			}),
		});

		const label = screen.queryByText('writes');

		expect(label).not.toBeInTheDocument();
	});
});
