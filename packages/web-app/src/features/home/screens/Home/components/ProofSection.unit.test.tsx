import { describe, expect, jest, test } from '@jest/globals';
import { RunStatus } from '@lightsout/engine/contracts';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { ProofSection } from '#src/features/home/screens/Home/components/ProofSection.tsx';
import { getDemoRunListings } from '#src/lightsout/index.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
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

/**
 * `repoRoot` is passed explicitly rather than defaulted, because an explicit
 * `undefined` is the public build — the case a default parameter would swallow.
 */
const setupProofSection = ({ repoRoot }: { repoRoot: string | undefined }) => {
	renderWithQueryClient({ ui: <ProofSection />, seed: [{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } }] });
};

describe('ProofSection', () => {
	test('states what the whole section is for', () => {
		setupProofSection({ repoRoot: undefined });

		expect(screen.getByRole('heading', { level: 2, name: 'The model can claim success. Lightsout requires evidence.' })).toBeInTheDocument();
	});

	test('offers a panel per frozen run, named for what each one shows', () => {
		setupProofSection({ repoRoot: undefined });
		// The open panel holds the real run detail page, which carries a tab strip
		// of its own — so this reads the section's own strip, the first on the page.
		const [sectionTabs] = screen.getAllByRole('tablist');
		const tabs = within(sectionTabs)
			.getAllByRole('tab')
			.map((tab) => tab.textContent);

		expect(tabs).toStrictEqual(['A clean run', 'A refactor burn-down', 'A run that stopped']);
	});

	test('addresses the open panel by the run’s own short id, so the frame is not showing an invented URL', () => {
		setupProofSection({ repoRoot: undefined });
		const clean = getDemoRunListings().find((listing) => listing.pipeline === 'implement' && listing.status === RunStatus.Passed);

		expect(screen.getByText(`lightsout.dev/repo/runs/${clean?.shortId}`)).toBeInTheDocument();
	});

	test('offers this project’s own runs when no repo was found, which is what that page then serves', () => {
		setupProofSection({ repoRoot: undefined });

		expect(screen.getByRole('link', { name: 'Browse lightsout’s own runs →' })).toHaveAttribute('href', '/repo/runs');
	});

	test('offers the reader’s runs instead when one was, since the same page then serves those', () => {
		setupProofSection({ repoRoot: '/repos/other-project' });

		expect(screen.getByRole('link', { name: 'Browse this repo’s runs →' })).toBeInTheDocument();
	});

	test('says what a reader is looking at', () => {
		setupProofSection({ repoRoot: undefined });

		expect(screen.getByText('Every run leaves this behind.')).toBeInTheDocument();
	});
});
