import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HeroSection } from '#src/features/home/screens/Home/components/HeroSection.tsx';

// Mocked Imports
// -------------------------
// Only the link, which needs a live router around it to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children }: { to: string; params?: Record<string, string>; children: ReactNode }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)}>{children}</a>
	),
}));
// -------------------------

const realRequest = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

/** The chart's loop is driven by hand: jsdom's own frames land outside React's act boundary. */
const setupHero = () => {
	Object.assign(globalThis, { requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined });

	render(<HeroSection />);
};

afterEach(() => {
	Object.assign(globalThis, { requestAnimationFrame: realRequest, cancelAnimationFrame: realCancel });
});

describe('HeroSection', () => {
	test('leads with the pain in three words', () => {
		setupHero();

		const headline = screen.getByRole('heading', { level: 1 });

		expect(headline.textContent).toBe('Stop the slop.');
	});

	test('says what the reader has been watching happen, and what this does about it', () => {
		setupHero();

		expect(screen.getByText(/the repo’s worst shortcut copied as precedent/)).toBeInTheDocument();
		expect(screen.getByText(/proves it with your own tests, not the agent’s word/)).toBeInTheDocument();
	});

	test('offers the install line as the primary call to action', () => {
		setupHero();

		expect(screen.getByText('/plugin marketplace add dc-devs/lightsout')).toBeInTheDocument();
	});

	test('offers the default pack as the way to see what the standards mean', () => {
		setupHero();

		const link = screen.getByRole('link', { name: 'See what the standards look like →' });

		expect(link).toHaveAttribute('href', '/standards/lightsout-defaults');
	});

	test('draws this repository’s own history beside the copy', () => {
		setupHero();

		expect(screen.getByRole('img', { name: /Repository file sizes over time/ })).toBeInTheDocument();
	});
});
