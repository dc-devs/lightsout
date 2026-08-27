import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackRuleListing, StandardsPackRuleView, StandardsPackView } from '@lightsout/engine';
import { screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import type { PackRuleFilters } from '#src/features/packs/common/types/PackRuleFilters.ts';
import { PackDetail } from '#src/features/packs/index.ts';
import { buildStandardsPackRuleListing } from '#tests/helpers/buildStandardsPackRuleListing.ts';
import { buildStandardsPackRuleView } from '#tests/helpers/buildStandardsPackRuleView.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Links need a live router to resolve a path; the trail, the cap chips and every
// rule row carry one. A plain anchor keeps the assertions about where the page
// points rather than about the routing library.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------
// The reader, not the server function in front of it: the showcase strip fetches
// each of its rules for itself, so those queries are deliberately left unseeded
// and answered here.
const mockGetPackRule = jest.fn<(params: { name: string; rule: string }) => Promise<StandardsPackRuleView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPackRule: (params: { name: string; rule: string }) => mockGetPackRule(params) }),
}));
// -------------------------

/** Every skeleton still on the page. The placeholder carries no role, so the slot it stamps is what a test can see it by. */
const countSkeletons = () => document.querySelectorAll('[data-slot="skeleton"]').length;

/** The showcase strip alone. Every summary it prints also appears in the rule list below, so a page-wide query would find both. */
const readShowcase = () => within(screen.getByRole('region', { name: 'What the code looks like' }));

const setupPackDetail = ({
	pack = buildStandardsPackView(),
	rule = buildStandardsPackRuleView(),
	filters = {},
	rejection,
}: {
	pack?: StandardsPackView;
	rule?: StandardsPackRuleView;
	filters?: PackRuleFilters;
	rejection?: Error;
} = {}) => {
	if (rejection === undefined) {
		mockGetPackRule.mockImplementation(({ rule: id }) => Promise.resolve({ ...rule, id }));
	} else {
		mockGetPackRule.mockRejectedValue(rejection);
	}

	renderWithQueryClient({
		ui: <PackDetail name={pack.name} filters={filters} onFiltersChange={() => {}} />,
		seed: [{ queryKey: [QueryKey.Pack, pack.name], data: pack }],
	});

	return { pack };
};

/** A pack whose rules are none of the six the showcase leads with, so the strip stays out of the way. */
const buildQuietPack = ({ rules, overrides }: { rules?: StandardsPackRuleListing[]; overrides?: Partial<StandardsPackView> } = {}) =>
	buildStandardsPackView({
		rules: rules ?? [buildStandardsPackRuleListing({ id: 'crowded-folder', summary: 'a folder holding too many things' })],
		overrides,
	});

describe('PackDetail', () => {
	test('puts the packs list one step back in the trail, so a reader can leave the way they came', () => {
		setupPackDetail({ pack: buildQuietPack() });

		const crumb = screen.getByRole('link', { name: 'Standards packs' });

		expect(crumb).toHaveAttribute('href', '/standards');
	});

	test('names the pack as the page, and says what the pack says about itself', () => {
		setupPackDetail({ pack: buildQuietPack() });

		expect(screen.getByRole('heading', { level: 1, name: 'lightsout-defaults' })).toBeInTheDocument();
		expect(screen.getByText('The default TypeScript pack.')).toBeInTheDocument();
	});

	test('reports the totals the engine supplied rather than counting for itself', () => {
		setupPackDetail({
			pack: buildQuietPack({
				rules: [buildStandardsPackRuleListing({ id: 'crowded-folder' }), buildStandardsPackRuleListing({ id: 'casing', checked: false })],
			}),
		});

		const counts = screen.getByText(/2 rules · 1 enforced by code/);

		expect(counts).toBeInTheDocument();
	});

	test('tells a reader the default pack needs no config entry at all', () => {
		setupPackDetail({ pack: buildQuietPack() });

		const line = screen.getByText(/Loads when your config names no/);

		expect(line).toBeInTheDocument();
	});

	test("offers any other pack's own repo-relative path as the entry to paste", () => {
		setupPackDetail({
			pack: buildStandardsPackView({
				name: 'acme-house-rules',
				isDefault: false,
				path: 'packages/house-standards',
				rules: [buildStandardsPackRuleListing({ id: 'crowded-folder' })],
			}),
		});

		const snippet = JSON.parse(screen.getByText(/"standards-packs"/).textContent ?? '');

		expect(snippet).toStrictEqual({ 'standards-packs': ['packages/house-standards'] });
	});

	test('says a pack applies to no channel in particular rather than trailing off after the counts', () => {
		setupPackDetail({ pack: buildQuietPack({ overrides: { channels: [] } }) });

		const counts = screen.getByText(/no channels$/);

		expect(counts).toBeInTheDocument();
	});

	test('says once, in the header, when a pack shipped without the code that proves its rules', () => {
		setupPackDetail({ pack: buildQuietPack({ rules: [buildStandardsPackRuleListing({ id: 'crowded-folder', fixtureCounts: { pass: 0, fail: 0 } })] }) });

		const notice = screen.getByText('This pack shipped without its fixtures.');

		expect(notice).toBeInTheDocument();
	});
});

describe('PackDetail showcase', () => {
	test('leads with the showcased rules the pack carries, in the order the constant names them rather than the pack', async () => {
		setupPackDetail({
			pack: buildStandardsPackView({
				rules: [
					buildStandardsPackRuleListing({ id: 'object-args', summary: 'a positional argument list' }),
					buildStandardsPackRuleListing({ id: 'type-assertion', summary: 'an `as` cast where narrowing would do' }),
				],
			}),
		});

		await readShowcase().findByText('a positional argument list');

		const summaries = readShowcase()
			.getAllByText(/an `as` cast where narrowing would do|a positional argument list/)
			.map((node) => node.textContent);

		expect(summaries).toStrictEqual(['an `as` cast where narrowing would do', 'a positional argument list']);
	});

	test('shows each showcased rule over the code it is arguing about', async () => {
		setupPackDetail();

		const fail = await readShowcase().findByText('return (value as string).toUpperCase();');

		expect(fail).toBeInTheDocument();
	});

	test('holds the space with a placeholder while a showcased rule is still on its way', () => {
		mockGetPackRule.mockReturnValue(new Promise<StandardsPackRuleView>(() => {}));
		renderWithQueryClient({
			ui: <PackDetail name="lightsout-defaults" filters={{}} onFiltersChange={() => {}} />,
			seed: [{ queryKey: [QueryKey.Pack, 'lightsout-defaults'], data: buildStandardsPackView() }],
		});

		expect(countSkeletons()).toBeGreaterThan(0);
	});

	test('drops a showcased rule that will not load rather than letting one rule take the page down', async () => {
		setupPackDetail({ rejection: new Error('the fixture folder is unreadable') });

		await waitFor(() => expect(countSkeletons()).toBe(0));

		expect(screen.getByRole('heading', { name: 'What the code looks like' })).toBeInTheDocument();
		expect(readShowcase().queryByText('an `as` cast where narrowing would do')).not.toBeInTheDocument();
	});

	test('stays up when the filters leave no rule at all, because the strip introduces the pack rather than the selection', async () => {
		setupPackDetail({ filters: { text: 'nothing answers to this' } });

		const fail = await readShowcase().findByText('return (value as string).toUpperCase();');

		expect(fail).toBeInTheDocument();
		expect(screen.getByText('No rules match these filters.')).toBeInTheDocument();
	});

	test('renders no showcase at all for a pack that carries none of the six, heading included', () => {
		setupPackDetail({ pack: buildQuietPack() });

		const heading = screen.queryByRole('heading', { name: 'What the code looks like' });

		expect(heading).not.toBeInTheDocument();
	});

	test('renders none of it either when the pack shipped without the fixtures the strip exists to show', () => {
		setupPackDetail({
			pack: buildStandardsPackView({ rules: [buildStandardsPackRuleListing({ id: 'type-assertion', fixtureCounts: { pass: 0, fail: 0 } })] }),
		});

		const heading = screen.queryByRole('heading', { name: 'What the code looks like' });

		expect(heading).not.toBeInTheDocument();
	});
});

describe('PackDetail caps', () => {
	test('reads every cap off the pack, so tuning one in the pack changes what the page says', () => {
		setupPackDetail({ pack: buildQuietPack({ rules: [buildStandardsPackRuleListing({ id: 'file-size', defaultSettings: { maxLines: 250 } })] }) });

		const chip = screen.getByRole('link', { name: /file-size · maxLines = 250/ });

		expect(chip).toHaveAttribute('href', '/standards/lightsout-defaults/file-size');
	});

	test('says what a cap is for once, above the whole strip', () => {
		setupPackDetail({ pack: buildQuietPack({ rules: [buildStandardsPackRuleListing({ id: 'file-size', defaultSettings: { maxLines: 250 } })] }) });

		const line = screen.getByText('Past the cap, it graduates.');

		expect(line).toBeInTheDocument();
	});

	test('renders nothing at all, heading included, for a pack that enforces no numbers', () => {
		setupPackDetail({ pack: buildQuietPack() });

		const heading = screen.queryByRole('heading', { name: 'The caps' });

		expect(heading).not.toBeInTheDocument();
	});
});
