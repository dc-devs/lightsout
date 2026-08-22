import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Skeleton } from '#src/appUI/Skeleton.tsx';

const setupSkeleton = ({ className }: { className?: string } = {}) => {
	render(<Skeleton className={className} data-testid="skeleton" />);
};

describe('Skeleton', () => {
	test('renders a pulsing placeholder block', () => {
		setupSkeleton();

		const skeleton = screen.getByTestId('skeleton');

		expect(skeleton.className).toContain('animate-pulse');
	});

	test('lets the caller size it', () => {
		setupSkeleton({ className: 'h-20' });

		const skeleton = screen.getByTestId('skeleton');

		expect(skeleton.className).toContain('h-20');
	});
});
