import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackRuleListing, StandardsPackRuleView, StandardsPackView } from '@lightsout/engine';
import { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
// Links need a live router to resolve a path; every rule row carries one. A
// plain anchor keeps the assertions about where the row points rather than
// about the routing library.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------
// The reader, not the server function in front of it: a row fetches its own
// fixture text the first time it is opened, so that query is deliberately left
// unseeded and answered here.
const mockGetPackRule = jest.fn<(params: { name: string; rule: string }) => Promise<StandardsPackRuleView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPackRule: (params: { name: string; rule: string }) => mockGetPackRule(params) }),
}));
// -------------------------

// None of these ids is one the showcase strip leads with, so these pages carry
// the filter bar and the rule list and nothing else.
const rules: StandardsPackRuleListing[] = [
	buildStandardsPackRuleListing({
		id: 'crowded-folder',
		summary: 'a folder holding too many things',
		documentPath: 'code/architecture/folder-structure',
		defaultSettings: { cap: 20 },
	}),
	buildStandardsPackRuleListing({
		id: 'casing',
		summary: 'a name spelled in the wrong case',
		documentPath: 'code/architecture/folder-structure',
		checked: false,
		defaultSeverity: StandardsSeverity.Advisory,
	}),
	buildStandardsPackRuleListing({
		id: 'test-nested-describe',
		summary: 'a describe inside a describe',
		documentPath: 'tests/unit-testing',
		set: StandardsSet.Tests,
	}),
	buildStandardsPackRuleListing({
		id: 'component-file-structure',
		summary: 'a component folder that bundles nothing',
		documentPath: 'code/architecture/react',
		channel: 'react',
		checked: false,
		defaultSeverity: StandardsSeverity.Advisory,
	}),
];

const setupPackDetail = ({
	filters = {},
	pack = buildStandardsPackView({ rules }),
	rejection,
}: {
	filters?: PackRuleFilters;
	pack?: StandardsPackView;
	rejection?: Error;
} = {}) => {
	if (rejection === undefined) {
		mockGetPackRule.mockImplementation(({ rule }) => Promise.resolve(buildStandardsPackRuleView({ id: rule })));
	} else {
		mockGetPackRule.mockRejectedValue(rejection);
	}

	const onFiltersChange = jest.fn<(filters: PackRuleFilters) => void>();

	renderWithQueryClient({
		ui: <PackDetail name={pack.name} filters={filters} onFiltersChange={onFiltersChange} />,
		seed: [{ queryKey: [QueryKey.Pack, pack.name], data: pack }],
	});

	return { onFiltersChange, pack };
};

/**
 * One rule's row, opened, returned so assertions can name what is inside it.
 *
 * jsdom implements no activation behaviour for `<summary>` — a click on it
 * leaves the disclosure shut — so the row is opened through the property a
 * browser's own click would set, followed by the `toggle` event the browser
 * would then fire.
 */
const openRow = ({ summary }: { summary: string }) => {
	const row = screen.getByText(summary).closest('details');

	if (row === null) {
		throw new Error(`no rule row holding "${summary}"`);
	}

	row.open = true;
	fireEvent(row, new Event('toggle'));

	return row;
};

/** One named group of toggles — two groups offer a toggle spelled `code`, so every query names its group. */
const readGroup = ({ label }: { label: string }) => within(screen.getByRole('group', { name: label }));

describe('PackDetail filter bar', () => {
	test('offers a toggle for each value the pack actually holds, under the question it answers', () => {
		setupPackDetail();

		expect(readGroup({ label: 'set' }).getByRole('button', { name: 'tests' })).toBeInTheDocument();
		expect(readGroup({ label: 'channel' }).getByRole('button', { name: 'react' })).toBeInTheDocument();
		expect(readGroup({ label: 'enforced by' }).getByRole('button', { name: 'judgment' })).toBeInTheDocument();
		expect(readGroup({ label: 'severity' }).getByRole('button', { name: 'advisory' })).toBeInTheDocument();
	});

	test('offers no toggle a pack can never answer, so nothing on the bar leads to an empty list by construction', () => {
		setupPackDetail({ pack: buildStandardsPackView({ rules: [rules[0], rules[1]] }) });

		expect(screen.queryByRole('group', { name: 'set' })).not.toBeInTheDocument();
		expect(screen.queryByRole('group', { name: 'channel' })).not.toBeInTheDocument();
	});

	test('keeps offering every value the pack holds while a filter is in force, so a toggle cannot vanish as it is pressed', () => {
		setupPackDetail({ filters: { set: StandardsSet.Tests } });

		expect(readGroup({ label: 'set' }).getByRole('button', { name: 'code' })).toBeInTheDocument();
		expect(readGroup({ label: 'channel' }).getByRole('button', { name: 'react' })).toBeInTheDocument();
	});

	test('asks the page to narrow to whatever was pressed', () => {
		const { onFiltersChange } = setupPackDetail();

		fireEvent.click(readGroup({ label: 'set' }).getByRole('button', { name: 'tests' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ set: StandardsSet.Tests });
	});

	test('narrows by who enforces a rule, which the URL spells in words and the rule listing in a boolean', () => {
		const { onFiltersChange } = setupPackDetail();

		fireEvent.click(readGroup({ label: 'enforced by' }).getByRole('button', { name: 'judgment' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ checked: false });
	});

	test('narrows by the severity a rule ships at', () => {
		const { onFiltersChange } = setupPackDetail();

		fireEvent.click(readGroup({ label: 'severity' }).getByRole('button', { name: 'advisory' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ severity: StandardsSeverity.Advisory });
	});

	test('narrows by channel, so a React repo can see what applies to it', () => {
		const { onFiltersChange } = setupPackDetail();

		fireEvent.click(readGroup({ label: 'channel' }).getByRole('button', { name: 'react' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ channel: 'react' });
	});

	test('marks the pressed toggle as the one in force', () => {
		setupPackDetail({ filters: { set: StandardsSet.Tests } });

		const toggle = readGroup({ label: 'set' }).getByRole('button', { name: 'tests' });

		expect(toggle).toHaveAttribute('aria-pressed', 'true');
	});

	test('clears that filter when the toggle already in force is pressed again, so every selection has a way back', () => {
		const { onFiltersChange } = setupPackDetail({ filters: { set: StandardsSet.Tests } });

		fireEvent.click(readGroup({ label: 'set' }).getByRole('button', { name: 'tests' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ set: undefined });
	});

	test('gives the channel toggle the same way back, so a reader who narrowed to one channel can see the pack whole again', () => {
		const { onFiltersChange } = setupPackDetail({ filters: { channel: 'react' } });

		fireEvent.click(readGroup({ label: 'channel' }).getByRole('button', { name: 'react' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ channel: undefined });
	});

	test('gives the enforced-by toggle the same way back, rather than stranding a reader on one half of the pack', () => {
		const { onFiltersChange } = setupPackDetail({ filters: { checked: false } });

		fireEvent.click(readGroup({ label: 'enforced by' }).getByRole('button', { name: 'judgment' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ checked: undefined });
	});

	test('gives the severity toggle the same way back, so pressing it twice is the same as never pressing it', () => {
		const { onFiltersChange } = setupPackDetail({ filters: { severity: StandardsSeverity.Advisory } });

		fireEvent.click(readGroup({ label: 'severity' }).getByRole('button', { name: 'advisory' }));

		expect(onFiltersChange).toHaveBeenCalledWith({ severity: undefined });
	});

	test('narrows by what a reader types, over both the id and the summary', () => {
		const { onFiltersChange } = setupPackDetail();

		fireEvent.change(screen.getByRole('searchbox', { name: /Filter rules/ }), { target: { value: 'folder' } });

		expect(onFiltersChange).toHaveBeenCalledWith({ text: 'folder' });
	});

	test('drops the text filter entirely when the box is emptied, rather than keeping an empty one', () => {
		const { onFiltersChange } = setupPackDetail({ filters: { text: 'folder' } });

		fireEvent.change(screen.getByRole('searchbox', { name: /Filter rules/ }), { target: { value: '' } });

		expect(onFiltersChange).toHaveBeenCalledWith({ text: undefined });
	});

	test('says how much of the pack the current filters leave', () => {
		setupPackDetail({ filters: { checked: true } });

		const count = screen.getByText('2 of 4 rules');

		expect(count).toBeInTheDocument();
	});
});

describe('PackDetail with no matches', () => {
	test('says so in one line rather than showing a run of empty document headings', () => {
		setupPackDetail({ filters: { text: 'nothing answers to this' } });

		expect(screen.getByText('No rules match these filters.')).toBeInTheDocument();
		expect(screen.queryByText('code/architecture/folder-structure')).not.toBeInTheDocument();
	});

	test('offers the way out beside it, wired to the same handler the bar uses', () => {
		const { onFiltersChange } = setupPackDetail({ filters: { text: 'nothing answers to this' } });

		fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

		expect(onFiltersChange).toHaveBeenCalledWith({});
	});

	test('keeps the caps strip up, because it introduces the pack rather than the current selection', () => {
		setupPackDetail({ filters: { text: 'nothing answers to this' } });

		const chip = screen.getByRole('link', { name: /crowded-folder · cap = 20/ });

		expect(chip).toBeInTheDocument();
	});
});

describe('PackDetail rule list', () => {
	test('groups the rules under the document each of them is stated in', () => {
		setupPackDetail();

		const documents = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

		expect(documents).toContain('code/architecture/folder-structure');
		expect(documents).toContain('tests/unit-testing');
	});

	test("keeps each document's own argument collapsed, since a reader scanning for a rule wants the list", () => {
		setupPackDetail();

		const intro = screen.getAllByText('What this document argues')[0].closest('details');

		expect(intro).not.toHaveAttribute('open');
	});

	test('draws no introduction at all under a document that states none', () => {
		setupPackDetail({
			pack: buildStandardsPackView({
				rules: [rules[0]],
				documents: [{ set: StandardsSet.Code, path: 'code/architecture/folder-structure', channel: 'base', intro: '', ruleIds: ['crowded-folder'] }],
			}),
		});

		const intro = screen.queryByText('What this document argues');

		expect(intro).not.toBeInTheDocument();
	});

	test("points every row at the rule's own page", () => {
		setupPackDetail();

		const link = screen.getByRole('link', { name: 'crowded-folder' });

		expect(link).toHaveAttribute('href', '/standards/lightsout-defaults/crowded-folder');
	});

	test('says who enforces each rule and how loudly, without a reader having to open it', () => {
		setupPackDetail();

		const row = screen.getByText('a name spelled in the wrong case').closest('summary');

		expect(row?.textContent).toContain('judgment');
		expect(row?.textContent).toContain('advisory');
	});

	test("asks for a rule's code only once the row is opened, so a hundred rules cost one small payload", () => {
		setupPackDetail();

		expect(mockGetPackRule).not.toHaveBeenCalled();
	});

	test('shows that code once the row is open', async () => {
		setupPackDetail();

		openRow({ summary: 'a folder holding too many things' });

		const fail = await screen.findByText('return (value as string).toUpperCase();');

		expect(fail).toBeInTheDocument();
	});

	test('asks for exactly the rule whose row was opened', async () => {
		setupPackDetail();

		openRow({ summary: 'a folder holding too many things' });

		await waitFor(() => expect(mockGetPackRule).toHaveBeenCalledWith({ name: 'lightsout-defaults', rule: 'crowded-folder' }));
	});

	test('says one line and nothing more when a row cannot load its code, rather than taking the page down', async () => {
		setupPackDetail({ rejection: new Error('the fixture folder is unreadable') });

		openRow({ summary: 'a folder holding too many things' });

		const notice = await screen.findByText("Could not load this rule's fixtures.");

		expect(notice).toBeInTheDocument();
	});

	test('asks the server for nothing at all on a rule the pack shipped without fixtures for', async () => {
		setupPackDetail({
			pack: buildStandardsPackView({
				rules: [buildStandardsPackRuleListing({ id: 'crowded-folder', summary: 'a folder holding too many things', fixtureCounts: { pass: 0, fail: 0 } })],
			}),
		});

		const row = openRow({ summary: 'a folder holding too many things' });

		const notice = await within(row).findByText('This pack shipped without its fixtures.');

		expect(notice).toBeInTheDocument();
		expect(mockGetPackRule).not.toHaveBeenCalled();
	});

	test('lists only what survived the filters', () => {
		setupPackDetail({ filters: { set: StandardsSet.Tests } });

		expect(screen.getByText('a describe inside a describe')).toBeInTheDocument();
		expect(screen.queryByText('a folder holding too many things')).not.toBeInTheDocument();
	});
});
