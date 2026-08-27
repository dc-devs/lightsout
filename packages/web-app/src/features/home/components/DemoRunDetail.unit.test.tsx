import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DemoRunDetail } from '#src/features/home/components/DemoRunDetail.tsx';
import { DemoRunSlug, getDemoRunViews } from '#src/lightsout/index.ts';

// Mocked Imports
// -------------------------
// Only the links a run's evidence can carry, which need a live router around
// them to resolve a path. The component under test turns them into plain text,
// so this stands in for the thing it is not supposed to render.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
// -------------------------

const setupDemoRunDetail = ({ slug = DemoRunSlug.Implement }: { slug?: DemoRunSlug } = {}) => {
	jest.useFakeTimers();

	render(<DemoRunDetail slug={slug} />);

	return { view: getDemoRunViews()[slug] };
};

describe('DemoRunDetail', () => {
	test('renders the frozen run through the components the local viewer uses, so the two cannot drift', () => {
		const { view } = setupDemoRunDetail();

		expect(screen.getByRole('heading', { level: 1, name: view.listing.title })).toBeInTheDocument();
	});

	test('offers the same tabs the run detail page does', () => {
		setupDemoRunDetail();

		const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);

		expect(tabs).toStrictEqual(['Overview', 'Steps', 'Gates', 'Agents', 'Files', 'Friction']);
	});

	test('renders whichever of the three it was asked for', () => {
		const { view } = setupDemoRunDetail({ slug: DemoRunSlug.Refactor });

		expect(screen.getByText(view.listing.shortId)).toBeInTheDocument();
	});

	test('routes nowhere: nothing in the frame points at a page', () => {
		setupDemoRunDetail({ slug: DemoRunSlug.Stopped });

		// The timeline's segments jump to a step inside this same frame, so they
		// stay. What must not survive is a link to a path — a frozen run's ids
		// belong to no live router, and `linksDisabled` is what removes them.
		const routed = screen.queryAllByRole('link').filter((link) => (link.getAttribute('href') ?? '').startsWith('/'));

		expect(routed).toStrictEqual([]);
	});

	test('clips the frame rather than letting a long run push the section open', () => {
		const { container } = render(<DemoRunDetail slug={DemoRunSlug.Implement} />);

		expect(container.firstChild).toHaveClass('overflow-hidden');
	});
});
