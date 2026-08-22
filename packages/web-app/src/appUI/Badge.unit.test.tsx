import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Badge } from '#src/appUI/Badge.tsx';
import type { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

const setupBadge = ({ variant, className }: { variant?: BadgeVariant; className?: string } = {}) => {
	render(
		<Badge variant={variant} className={className}>
			done
		</Badge>,
	);
};

describe('Badge', () => {
	test('renders its label', () => {
		setupBadge();

		const badge = screen.getByText('done');

		expect(badge).toBeInTheDocument();
	});

	test('falls back to the neutral variant when none is given', () => {
		setupBadge();

		const badge = screen.getByText('done');

		expect(badge.className).toContain('bg-muted');
	});

	test('reaches the status token of the variant it is given', () => {
		setupBadge({ variant: 'failed' });

		const badge = screen.getByText('done');

		expect(badge.className).toContain('text-status-failed');
	});

	test.each([
		{ variant: 'blocking' as const, token: 'text-severity-blocking' },
		{ variant: 'advisory' as const, token: 'text-severity-advisory' },
	])('colours a $variant finding by severity rather than by the brand accent', ({ variant, token }) => {
		setupBadge({ variant });

		const badge = screen.getByText('done');

		expect(badge.className).toContain(token);
	});

	test('carries the one brand gradient on the brand variant', () => {
		setupBadge({ variant: 'brand' });

		const badge = screen.getByText('done');

		expect(badge.className).toContain('bg-[image:var(--brand-gradient)]');
	});

	test('is square by default, so a page of tags does not read as a page of run states', () => {
		setupBadge();

		const classes = screen.getByText('done').className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['rounded-sm']));
		expect(classes).not.toContain('rounded-full');
	});

	test.each([
		{ variant: 'running' as const },
		{ variant: 'passed' as const },
		{ variant: 'failed' as const },
		{ variant: 'paused' as const },
		{ variant: 'escalated' as const },
	])('keeps the pill shape for the $variant run-status family', ({ variant }) => {
		setupBadge({ variant });

		const classes = screen.getByText('done').className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['rounded-full']));
		expect(classes).not.toContain('rounded-sm');
	});

	test('leaves a non-status variant square, so only run state gets the pill', () => {
		setupBadge({ variant: 'blocking' });

		const classes = screen.getByText('done').className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['rounded-sm']));
		expect(classes).not.toContain('rounded-full');
	});

	test('lets a caller class replace the shape the badge picked for itself, rather than printing both', () => {
		setupBadge({ className: 'rounded-none' });

		const classes = screen.getByText('done').className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['rounded-none']));
		expect(classes).not.toContain('rounded-full');
	});
});
