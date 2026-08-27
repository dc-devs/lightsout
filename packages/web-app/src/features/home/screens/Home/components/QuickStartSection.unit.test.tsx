import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { QuickStartSection } from '#src/features/home/screens/Home/components/QuickStartSection.tsx';

describe('QuickStartSection', () => {
	test('ends on the install line, which is what the page has been asking for all along', () => {
		render(<QuickStartSection />);

		expect(screen.getByText('/plugin marketplace add dc-devs/lightsout')).toBeInTheDocument();
	});

	test('shows the smallest config that runs, and offers it to the clipboard', () => {
		render(<QuickStartSection />);

		const config = screen.getByText(/"test-coverage": "pnpm test:unit:coverage"/);

		expect(config.textContent).toContain('"gates"');
		expect(screen.getByRole('button', { name: 'Copy config' })).toBeInTheDocument();
	});

	test('names the three commands in the order they are meant to be typed', () => {
		render(<QuickStartSection />);

		const steps = screen.getAllByRole('listitem').map((item) => item.querySelector('code')?.textContent);

		expect(steps).toStrictEqual(['/brainstorm', '/plan', '/implement']);
	});

	test('says what this is and where it lives', () => {
		render(<QuickStartSection />);

		const github = screen.getByRole('link', { name: 'GitHub' });

		expect(github.parentElement?.textContent).toContain('Pre-alpha · MIT');
	});
});
