import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ContentHeader } from '#src/appUI/ContentHeader.tsx';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const setupContentHeader = ({
	crumbs = [{ label: 'Your repo', link: { to: '/repo/runs' } }, { label: 'Runs', link: { to: '/repo/runs' } }, { label: 'a3808d03' }],
}: {
	crumbs?: Parameters<typeof ContentHeader>[0]['crumbs'];
} = {}) => {
	render(<ContentHeader crumbs={crumbs} />);
};

describe('ContentHeader', () => {
	test('announces itself as the breadcrumb trail', () => {
		setupContentHeader();

		const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });

		expect(trail).toBeInTheDocument();
	});

	test('links every crumb a reader can go back to', () => {
		setupContentHeader();

		const runs = screen.getByRole('link', { name: 'Runs' });

		expect(runs).toHaveAttribute('href', '/repo/runs');
	});

	test('leaves the last crumb unlinked, since it is the page already open', () => {
		setupContentHeader();

		const current = screen.getByText('a3808d03');

		expect(current.tagName).toBe('SPAN');
		expect(current).toHaveAttribute('aria-current', 'page');
	});

	test('separates each crumb from the one before it, and puts nothing in front of the first', () => {
		setupContentHeader();

		const separators = screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelectorAll('svg[aria-hidden="true"]');

		expect(separators).toHaveLength(2);
	});

	test('renders no separator at all for a trail of one crumb', () => {
		setupContentHeader({ crumbs: [{ label: 'Runs' }] });

		const separators = screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelectorAll('svg[aria-hidden="true"]');

		expect(separators).toHaveLength(0);
	});

	test('hands the router every part of a crumb link, so a path with parameters resolves', () => {
		setupContentHeader({ crumbs: [{ label: 'Runs', link: { to: '/repo/runs/$runId', params: { runId: 'a3808d03' } } }, { label: 'Steps' }] });

		const runs = screen.getByRole('link', { name: 'Runs' });

		expect(runs).toHaveAttribute('href', '/repo/runs/a3808d03');
	});
});
