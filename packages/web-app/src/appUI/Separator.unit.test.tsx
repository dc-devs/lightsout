import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Separator } from '#src/appUI/Separator.tsx';

const setupSeparator = ({ orientation, decorative, className }: { orientation?: 'vertical'; decorative?: boolean; className?: string } = {}) => {
	render(<Separator orientation={orientation} decorative={decorative} className={className} data-testid="separator" />);
};

describe('Separator', () => {
	test('renders horizontally by default', () => {
		setupSeparator();

		const separator = screen.getByTestId('separator');

		expect(separator).toHaveAttribute('data-orientation', 'horizontal');
	});

	test('renders vertically when asked', () => {
		setupSeparator({ orientation: 'vertical' });

		const separator = screen.getByTestId('separator');

		expect(separator).toHaveAttribute('data-orientation', 'vertical');
	});

	test('stays out of the accessibility tree by default, because a hairline rule carries no meaning', () => {
		setupSeparator();

		const separator = screen.getByTestId('separator');

		expect(separator).toHaveAttribute('role', 'none');
	});

	test('announces itself as a separator when the caller says it divides meaning', () => {
		setupSeparator({ decorative: false, orientation: 'vertical' });

		const separator = screen.getByRole('separator');

		expect(separator).toHaveAttribute('aria-orientation', 'vertical');
	});

	test('lets a caller class win over the thickness it picked for itself', () => {
		setupSeparator({ className: 'bg-transparent' });

		const separator = screen.getByTestId('separator');

		expect(separator.className.split(' ')).not.toContain('bg-border');
	});
});
