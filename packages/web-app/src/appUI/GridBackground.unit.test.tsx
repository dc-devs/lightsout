import { describe, expect, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { GridBackground } from '#src/appUI/GridBackground.tsx';

const setupGridBackground = ({ className }: { className?: string } = {}) => {
	const { container } = render(<GridBackground className={className} />);

	return { grid: container.firstElementChild };
};

describe('GridBackground', () => {
	test('is hidden from assistive technology, being decoration and nothing else', () => {
		const { grid } = setupGridBackground();

		expect(grid).toHaveAttribute('aria-hidden', 'true');
	});

	test('draws in the theme border colour rather than a literal, so it follows light and dark', () => {
		const { grid } = setupGridBackground();

		expect(grid?.getAttribute('style')).toContain('var(--border)');
	});

	test('fades to nothing at the edges rather than drawing a hard line across the section', () => {
		const { grid } = setupGridBackground();

		expect(grid?.getAttribute('style')).toContain('mask-image: radial-gradient(ellipse at center, black 20%, transparent 75%)');
	});

	test('takes no clicks, so it can never sit between a reader and a control', () => {
		const { grid } = setupGridBackground();

		expect(grid?.className).toContain('pointer-events-none');
	});

	test('lets a caller class through', () => {
		const { grid } = setupGridBackground({ className: 'opacity-30' });

		expect(grid?.className).toContain('opacity-30');
	});
});
