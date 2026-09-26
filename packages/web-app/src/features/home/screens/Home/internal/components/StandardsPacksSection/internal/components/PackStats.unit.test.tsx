import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { PackStats } from '#src/features/home/screens/Home/internal/components/StandardsPacksSection/internal/components/PackStats.tsx';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';

describe('PackStats', () => {
	test('counts each kind of rule from the pack', () => {
		render(
			<PackStats pack={buildStandardsPackListing({ overrides: { totals: { rules: 112, checked: 53, judgment: 59, documents: 24, withFixtures: 112 } } })} />,
		);

		expect(screen.getByText('53').parentElement).toHaveTextContent('53 deterministic checks');
	});

	test('still names both kinds before the pack answers, rather than showing a guessed number', () => {
		const { container } = render(<PackStats />);

		expect(container).toHaveTextContent('Deterministic checksAgent checks');
	});
});
