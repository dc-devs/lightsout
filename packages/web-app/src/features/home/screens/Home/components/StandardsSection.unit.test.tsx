import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackListing } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { StandardsSection } from '#src/features/home/screens/Home/components/StandardsSection.tsx';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';
import { buildStandardsPackRuleView } from '#tests/helpers/buildStandardsPackRuleView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The packs query is left unseeded in two cases below — a pack that never
// answers is the state the prose has to survive — so the reader behind it is
// stubbed with a promise that never settles rather than left to walk the real
// filesystem.
jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listPacks: () => new Promise(() => {}), getPackRule: () => new Promise(() => {}) }),
}));
// -------------------------
// Only the link, which needs a live router around it to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const showcase = ['type-assertion', 'object-args', 'bare-string-union'];

/**
 * `packs` left out entirely is the unresolved query, which is what a reader sees
 * for the first frame and what a build with an unreadable pack keeps.
 */
const setupStandardsSection = ({ packs, rules = showcase }: { packs?: StandardsPackListing[]; rules?: string[] } = {}) => {
	const seed = [
		...(packs === undefined ? [] : [{ queryKey: [QueryKey.Packs], data: packs }]),
		...rules.map((rule) => ({
			queryKey: [QueryKey.PackRule, 'lightsout-defaults', rule],
			data: buildStandardsPackRuleView({ id: rule, overrides: { summary: `what ${rule} argues` } }),
		})),
	];

	renderWithQueryClient({ ui: <StandardsSection />, seed });
};

describe('StandardsSection', () => {
	test('makes its argument whether or not any pack loaded, since the prose is the argument', () => {
		setupStandardsSection();

		expect(screen.getByRole('heading', { level: 2, name: 'Ship with ours. Mix in yours.' })).toBeInTheDocument();
	});

	test('quotes the default pack’s live numbers rather than a figure typed into the copy', () => {
		setupStandardsSection({
			packs: [
				buildStandardsPackListing({ overrides: { isDefault: true, totals: { rules: 111, checked: 52, judgment: 59, documents: 24, withFixtures: 111 } } }),
			],
		});

		expect(screen.getByText('111 rules · 52 enforced by code · 111 with a pass and a fail example')).toBeInTheDocument();
	});

	test('leads with three rules and the code each one is arguing about', () => {
		setupStandardsSection({ packs: [buildStandardsPackListing({ overrides: { isDefault: true } })] });

		const summaries = showcase.map((rule) => screen.getByText(`what ${rule} argues`));

		expect(summaries).toHaveLength(3);
	});

	test('sends a reader from a showcased rule to that rule’s own page', () => {
		setupStandardsSection({ packs: [buildStandardsPackListing({ overrides: { isDefault: true } })] });

		const links = screen.getAllByRole('link', { name: 'Read the rule →' });

		expect(links[0]).toHaveAttribute('href', '/standards/lightsout-defaults/type-assertion');
	});

	test('drops the numbers and the cards on a repo whose config names its own packs, where no entry is the default', () => {
		setupStandardsSection({ packs: [buildStandardsPackListing({ overrides: { name: 'acme', isDefault: false } })] });

		expect(screen.queryByText(/enforced by code/)).not.toBeInTheDocument();
		expect(screen.queryByText('what type-assertion argues')).not.toBeInTheDocument();
	});

	test('says the two framework channels switch themselves on', () => {
		setupStandardsSection();

		expect(screen.getByText('React and TanStack rules switch on automatically when those frameworks are detected.')).toBeInTheDocument();
	});
});
