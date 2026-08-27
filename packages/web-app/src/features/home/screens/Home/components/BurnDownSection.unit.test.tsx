import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BurnDownSection } from '#src/features/home/screens/Home/components/BurnDownSection.tsx';

// Mocked Imports
// -------------------------
// The router, which this section now links through. The stand-in substitutes
// the params into the path, so the assertion below reads the address a reader
// would actually land on.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

describe('BurnDownSection', () => {
	test('names the two commands aimed at code a repo already has', () => {
		render(<BurnDownSection />);

		const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

		expect(names).toStrictEqual(['/refactor', '/test-coverage-to-threshold']);
	});

	test('sends a reader to each command own manual page', () => {
		render(<BurnDownSection />);

		const links = screen.getAllByRole('link', { name: 'What it does →' });

		expect(links.map((link) => link.getAttribute('href'))).toStrictEqual(['/commands/refactor', '/commands/test-coverage-to-threshold']);
	});
});
