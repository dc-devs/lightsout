import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ClosingSection } from '#src/features/home/screens/Home/internal/components/ClosingSection.tsx';

// Mocked Imports
// -------------------------
// The docs link, which needs a live router around it to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children }: { to: string; params?: Record<string, string>; children: ReactNode }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)}>{children}</a>
	),
}));
// -------------------------

describe('ClosingSection', () => {
	test('closes on the promise the page made', () => {
		render(<ClosingSection />);

		expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Hand it off. Walk away.');
	});

	test('offers the install command once more', () => {
		render(<ClosingSection />);

		expect(screen.getByRole('button', { name: 'Copy install command' })).toBeInTheDocument();
	});

	test('points to the docs and the source', () => {
		render(<ClosingSection />);

		expect([
			screen.getByRole('link', { name: 'Read the docs' }).getAttribute('href'),
			screen.getByRole('link', { name: 'GitHub' }).getAttribute('href'),
		]).toStrictEqual(['/docs/configuration', 'https://github.com/lightsout-factory/lightsout']);
	});

	test('ends on the small print', () => {
		render(<ClosingSection />);

		expect(screen.getByRole('contentinfo')).toHaveTextContent('lightsoutAlphaMIT License');
	});
});
