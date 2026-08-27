import { describe, expect, jest, test } from '@jest/globals';
import type { ConfigView } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { ConfigPage } from '#src/features/config/index.ts';
import { buildConfigView } from '#tests/helpers/buildConfigView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Every pack and every rule on this page is a link into the pack pages, and a
// link needs a live router to resolve a path. A plain anchor keeps the
// assertions about where a row points rather than about the routing library.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const setupConfigPage = ({ overrides = {} }: { overrides?: Partial<ConfigView> } = {}) => {
	const view = buildConfigView({ overrides });

	renderWithQueryClient({ ui: <ConfigPage />, seed: [{ queryKey: [QueryKey.Config], data: view }] });

	return { view };
};

/**
 * The page reduced to one config key.
 *
 * The packs card marks the pack a repo named none of with a `default` badge of
 * its own, so a row's provenance badge can only be read unambiguously on a page
 * carrying no packs.
 */
const setupFieldRow = ({ field }: { field: ConfigView['sections'][number]['fields'][number] }) =>
	setupConfigPage({ overrides: { sections: [{ title: 'Gates', fields: [field] }], packs: [], ruleStates: [] } });

/** The severity facet over the ledger, opened and then narrowed the way a reader narrows it. */
const chooseSeverity = ({ name }: { name: RegExp }) => {
	fireEvent.click(screen.getByRole('button', { name: /severity/ }));
	fireEvent.click(screen.getByRole('checkbox', { name }));
};

describe('ConfigPage', () => {
	test('names the page and puts the file it read under that name, so a reader knows which config this is', () => {
		setupConfigPage({ overrides: { path: '/repos/other-project/lightsout.config.json' } });

		const heading = screen.getByRole('heading', { level: 1, name: 'Config' });

		expect(heading).toBeInTheDocument();
		expect(screen.getByText('/repos/other-project/lightsout.config.json')).toBeInTheDocument();
	});

	test('draws one card per section the view grouped, in the order it grouped them', () => {
		setupConfigPage({
			overrides: {
				sections: [
					{ title: 'Harness', fields: [{ key: 'harness', value: 'claude-code', fromConfig: true, description: 'Which agent harness runs the work.' }] },
					{ title: 'Gates', fields: [{ key: 'gates', value: { check: 'pnpm check' }, fromConfig: true, description: 'Verification commands.' }] },
				],
			},
		});

		const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

		expect(titles).toStrictEqual(['Harness', 'Gates', 'Standards packs loaded', 'Rules']);
	});

	test('sends a reader on to the doc that explains every key, since this page only shows what the file holds', () => {
		setupConfigPage();

		const link = screen.getByRole('link', { name: 'What every key means →' });

		expect(link).toHaveAttribute('href', '/docs/configuration');
	});
});

describe('ConfigPage field rows', () => {
	test('names the key exactly as the file spells it, so a reader can find it in their own config', () => {
		setupFieldRow({
			field: { key: 'coverage-summary-path', value: 'coverage/coverage-summary.json', fromConfig: false, description: 'Where the report lands.' },
		});

		const key = screen.getByText('coverage-summary-path');

		expect(key).toBeInTheDocument();
	});

	test('marks a value this repo chose, which is the half a reader cannot get by opening the file', () => {
		setupFieldRow({ field: { key: 'gates', value: { check: 'pnpm check' }, fromConfig: true, description: 'Verification commands.' } });

		expect(screen.getByText('from config')).toBeInTheDocument();
		expect(screen.queryByText('default')).not.toBeInTheDocument();
	});

	test('marks a value lightsout filled in, so nobody goes looking for it in their own file', () => {
		setupFieldRow({ field: { key: 'packages-dir', value: 'packages', fromConfig: false, description: 'Where packages live.' } });

		expect(screen.getByText('default')).toBeInTheDocument();
		expect(screen.queryByText('from config')).not.toBeInTheDocument();
	});

	test('prints a plain value as the JSON a reader would have typed into the file', () => {
		setupFieldRow({ field: { key: 'packages-dir', value: 'packages', fromConfig: false, description: 'Where packages live.' } });

		const value = screen.getByText('"packages"');

		expect(value).toBeInTheDocument();
	});

	test('pretty-prints a block value, because a one-line object is what nobody can read', () => {
		setupFieldRow({ field: { key: 'gates', value: { check: 'pnpm check', test: 'pnpm test' }, fromConfig: true, description: 'Verification commands.' } });

		const block = screen.getByText(/"check"/);

		expect(JSON.parse(block.textContent ?? '')).toStrictEqual({ check: 'pnpm check', test: 'pnpm test' });
	});

	test('says in words that a key has no default, rather than printing a null somebody would read as a setting', () => {
		setupFieldRow({ field: { key: 'vendored', value: null, fromConfig: false, description: 'Paths nobody here wrote.' } });

		expect(screen.getByText('default: none')).toBeInTheDocument();
		expect(screen.queryByText('null')).not.toBeInTheDocument();
	});

	test("carries the schema's own sentence about the key, so the page and the contract cannot disagree", () => {
		setupFieldRow({ field: { key: 'standards-checks', value: null, fromConfig: false, description: 'Per-rule severity and settings.' } });

		const description = screen.getByText('Per-rule severity and settings.');

		expect(description).toBeInTheDocument();
	});
});

describe('ConfigPage packs card', () => {
	test('points each loaded pack at its own page, which is where what it says lives', () => {
		setupConfigPage({
			overrides: { packs: [{ name: 'acme-house-rules', rootPath: '/repos/lightsout/packages/house', isDefault: false, channels: [] }] },
		});

		const link = screen.getByRole('link', { name: 'acme-house-rules' });

		expect(link).toHaveAttribute('href', '/standards/acme-house-rules');
	});

	test('shows where a pack was read from and which framework documents it carries', () => {
		setupConfigPage({
			overrides: { packs: [{ name: 'acme-house-rules', rootPath: '/repos/lightsout/packages/house', isDefault: false, channels: ['base', 'react'] }] },
		});

		expect(screen.getByText('/repos/lightsout/packages/house')).toBeInTheDocument();
		expect(screen.getByText('base')).toBeInTheDocument();
		expect(screen.getByText('react')).toBeInTheDocument();
	});

	test('marks the pack that loads when the config names none', () => {
		setupConfigPage({ overrides: { packs: [{ name: 'lightsout-defaults', rootPath: '/packs/defaults', isDefault: true, channels: [] }] } });

		const card = screen.getByRole('heading', { level: 3, name: 'Standards packs loaded' }).closest('section');

		expect(within(card as HTMLElement).getByText('default')).toBeInTheDocument();
	});

	test('says plainly that no pack loads here, rather than showing an empty card', () => {
		setupConfigPage({ overrides: { packs: [] } });

		const notice = screen.getByText(/No pack loads here/);

		expect(notice).toBeInTheDocument();
	});
});

describe('ConfigPage rule ledger', () => {
	const ruleStates: ConfigView['ruleStates'] = [
		{ rule: 'size-file', pack: 'lightsout-defaults', severity: StandardsSeverity.Blocking, fromConfig: true, settings: { file: 250 } },
		{ rule: 'loose-file', pack: 'lightsout-defaults', severity: StandardsSeverity.Advisory, fromConfig: false, settings: {} },
		{ rule: 'naming-boolean', pack: 'acme-house-rules', severity: StandardsSeverity.Off, fromConfig: true, settings: {} },
	];

	test('lists every loaded rule, whichever pack declared it', () => {
		setupConfigPage({ overrides: { ruleStates } });

		const rules = screen.getAllByRole('link', { name: /^(size-file|loose-file|naming-boolean)$/ }).map((link) => link.textContent);

		expect(rules).toStrictEqual(['size-file', 'loose-file', 'naming-boolean']);
	});

	test("points a rule at the pack that declares it, which is what the ledger's own pack field is for", () => {
		setupConfigPage({ overrides: { ruleStates } });

		const link = screen.getByRole('link', { name: 'naming-boolean' });

		expect(link).toHaveAttribute('href', '/standards/acme-house-rules/naming-boolean');
	});

	test('says of each rule whether this repo set its state or the pack did', () => {
		setupConfigPage({ overrides: { ruleStates } });

		const setters = screen.getAllByText(/^(this repo|the pack)$/).map((cell) => cell.textContent);

		expect(setters).toStrictEqual(['this repo', 'the pack', 'this repo']);
	});

	test('speaks the three states in three different colours, since a rule turned off is not a rule being broken', () => {
		setupConfigPage({ overrides: { ruleStates } });

		const families = [screen.getByText('blocking'), screen.getByText('advisory'), screen.getByText('off')].map((badge) => badge.className);

		expect(families[0]).toContain('text-severity-blocking');
		expect(families[1]).toContain('text-severity-advisory');
		expect(families[2]).toContain('text-muted-foreground-strong');
	});

	test('shows the numbers this repo tuned a rule to', () => {
		setupConfigPage({ overrides: { ruleStates } });

		const setting = screen.getByText(/^file\s+250$/);

		expect(setting).toBeInTheDocument();
	});

	test('leaves a dash where a repo tuned nothing, rather than an empty cell', () => {
		setupConfigPage({ overrides: { ruleStates: [ruleStates[1]] } });

		const cells = screen.getAllByText('—');

		expect(cells).toHaveLength(1);
	});

	test('narrows the ledger to the state a reader picked', () => {
		setupConfigPage({ overrides: { ruleStates } });

		chooseSeverity({ name: /advisory/ });

		expect(screen.getByRole('link', { name: 'loose-file' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'size-file' })).not.toBeInTheDocument();
	});

	test('offers each state with how many rules run at it, so a reader sees the shape before picking', () => {
		setupConfigPage({ overrides: { ruleStates } });

		fireEvent.click(screen.getByRole('button', { name: /severity/ }));

		expect(screen.getByRole('checkbox', { name: /blocking/ })).toHaveTextContent('1');
		expect(screen.getByRole('checkbox', { name: /^off/ })).toHaveTextContent('1');
	});

	test('says so when a chosen state has no rules at it, rather than showing a headed empty table', () => {
		setupConfigPage({ overrides: { ruleStates: [ruleStates[0]] } });

		chooseSeverity({ name: /^off/ });

		const notice = screen.getByText('No rules match this severity.');

		expect(notice).toBeInTheDocument();
	});
});
