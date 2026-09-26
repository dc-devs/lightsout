import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ProofSection } from '#src/features/home/screens/Home/components/ProofSection/ProofSection.tsx';

describe('ProofSection', () => {
	test('states what the whole section is for', () => {
		render(<ProofSection />);

		expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Deterministic gates decide what passes. Not the agent.');
	});

	test('shows the gates at work under the claim', () => {
		render(<ProofSection />);

		expect(screen.getByRole('figure', { name: 'A run’s log: what the agent said, and what the gates said back' })).toBeInTheDocument();
	});

	test('links nowhere, since the public site has no runs to browse', () => {
		render(<ProofSection />);

		expect(screen.queryByRole('link')).not.toBeInTheDocument();
	});
});
