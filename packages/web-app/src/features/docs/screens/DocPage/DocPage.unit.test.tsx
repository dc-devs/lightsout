import { describe, expect, test } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import { DocPage } from '#src/features/docs/index.ts';

const setupDocPage = ({ doc = 'configuration' }: { doc?: string } = {}) => {
	const { container } = render(<DocPage doc={doc} />);

	return { container };
};

/** The heading list above the document, which is the one landmark this page adds. */
const readToc = () => within(screen.getByRole('navigation', { name: 'On this page' }));

describe('DocPage', () => {
	test('names the page after the document rather than after the route param the reader typed', () => {
		setupDocPage({ doc: 'configuration' });

		const title = screen.getByRole('heading', { level: 1, name: 'Configuration' });

		expect(title).toBeInTheDocument();
	});

	test('serves the second document the site carries as well as the first', () => {
		setupDocPage({ doc: 'monorepos' });

		const title = screen.getByRole('heading', { level: 1, name: 'Monorepos' });

		expect(title).toBeInTheDocument();
	});

	test('renders nothing at all for a name no document answers to, rather than throwing', () => {
		const { container } = setupDocPage({ doc: 'no-such-doc' });

		expect(container).toBeEmptyDOMElement();
	});

	test('renders the document itself and not only its outline', () => {
		setupDocPage({ doc: 'monorepos' });

		const body = screen.getByText(/Whole-repository gates can make monorepo runs slower/);

		expect(body).toBeInTheDocument();
	});

	test('links a heading in the list to the anchor the rendered heading carries, so the link lands', () => {
		setupDocPage({ doc: 'configuration' });

		const entry = readToc().getByRole('link', { name: 'Minimal setup' });

		expect(entry).toHaveAttribute('href', '#minimal-setup');
		expect(document.getElementById('minimal-setup')).toBe(screen.getByRole('heading', { level: 2, name: 'Minimal setup' }));
	});

	test('lists a heading that spells a word in code without its backticks, and still lands on it', () => {
		setupDocPage({ doc: 'configuration' });

		const entry = readToc().getByRole('link', { name: 'Recommended .gitignore' });

		expect(entry).toHaveAttribute('href', '#recommended-gitignore');
	});

	test('lists the headings in the order the document writes them', () => {
		setupDocPage({ doc: 'configuration' });

		const entries = readToc().getAllByRole('link');

		expect(entries.slice(0, 3).map((entry) => entry.textContent)).toStrictEqual(['Minimal setup', 'Common configurations', 'Use lightsout’s code standards']);
	});

	test('indents a third-level heading under the second-level one it sits beneath', () => {
		setupDocPage({ doc: 'configuration' });

		const entries = readToc();

		expect(entries.getByRole('link', { name: 'Use your own standards' }).className).toContain('pl-4');
		expect(entries.getByRole('link', { name: 'Common configurations' }).className).not.toContain('pl-4');
	});

	test('lists only the levels it can link to, leaving the document title out of its own outline', () => {
		setupDocPage({ doc: 'monorepos' });

		const entries = readToc().getAllByRole('link');

		expect(entries.map((entry) => entry.textContent)).toStrictEqual(['How package gates work']);
	});
});
