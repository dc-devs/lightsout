import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Badge } from '#src/common/components/ui/Badge.tsx';

const setupBadge = ({ variant, className }: { variant?: 'passed' | 'failed'; className?: string } = {}) => {
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

	test('lets a caller class replace the shape the badge picked for itself, rather than printing both', () => {
		setupBadge({ className: 'rounded-none' });

		const classes = screen.getByText('done').className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['rounded-none']));
		expect(classes).not.toContain('rounded-full');
	});
});
