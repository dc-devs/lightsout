import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackView } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { StandardsPacksSection } from '#src/features/home/screens/Home/components/StandardsPacksSection/StandardsPacksSection.tsx';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The pack query is left unanswered unless a test seeds it, so the server
// function behind it is stubbed with a promise that never settles — the moment
// before the pack arrives, which is the state the page has to read well in.
jest.mock('#src/features/packs/serverFns/getDefaultPackServerFn.ts', () => ({ getDefaultPackServerFn: () => new Promise(() => {}) }));
// -------------------------
// Only the link, which needs a live router around it to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const setupSection = ({ pack }: { pack?: StandardsPackView } = {}) => {
	renderWithQueryClient({ ui: <StandardsPacksSection />, seed: pack === undefined ? [] : [{ queryKey: [QueryKey.DefaultPack], data: pack }] });
};

describe('StandardsPacksSection', () => {
	test('says the reader’s standards are enforced at every step, in two lines', () => {
		setupSection();

		expect(screen.getByRole('heading', { level: 2, name: 'Your standards, enforced at every step.' })).toBeInTheDocument();
	});

	test('shows the pack built into planning, implementation and refactoring', () => {
		setupSection();

		const steps = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

		expect(steps.slice(0, 3)).toStrictEqual(['Plan', 'Implement', 'Refactor']);
	});

	test('counts the pack’s deterministic checks and agent checks, from the pack itself', () => {
		setupSection({
			pack: { ...buildStandardsPackView(), totals: { rules: 112, checked: 53, judgment: 59, documents: 24, withFixtures: 112 } },
		});

		expect([screen.getByText('112'), screen.getByText('53'), screen.getByText('59')]).toHaveLength(3);
	});

	test('names the ready-made rule sets, and the team’s own', () => {
		setupSection();

		const chips = screen
			.getAllByRole('listitem')
			.map((item) => item.textContent)
			.slice(-4);

		expect(chips).toStrictEqual(['TypeScript', 'React', 'TanStack', 'Your team’s pack']);
	});

	test('sends a reader to the packs to browse them', () => {
		setupSection();

		expect(screen.getByRole('link', { name: 'Browse Standards Packs' })).toHaveAttribute('href', '/standards-packs');
	});

	test('shows the three settings a repo gives each rule', () => {
		setupSection();

		const settings = screen.getByText('Each rule is yours to set:').nextElementSibling?.textContent;

		expect(settings).toBe('BlockAdviseOff');
	});
});
