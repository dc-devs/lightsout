import { describe, expect, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { GridBackground } from '#src/appUI/GridBackground.tsx';
import { GridPattern } from '#src/common/constants/GridPattern.ts';

const setupGridBackground = ({ pattern, maskImage, className }: { pattern?: GridPattern; maskImage?: string; className?: string } = {}) => {
	const { container } = render(<GridBackground pattern={pattern} maskImage={maskImage} className={className} />);

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

	test('draws ruled lines unless told otherwise', () => {
		const { grid } = setupGridBackground();

		expect(grid?.getAttribute('style')).toContain('repeating-linear-gradient');
	});

	test('draws a fine 40px square grid when a section asks for squares', () => {
		const { grid } = setupGridBackground({ pattern: GridPattern.Squares });

		expect(grid?.getAttribute('style')).toContain('background-size: 40px 40px');
	});

	test('fades the way a section asks, when it names a mask of its own', () => {
		const { grid } = setupGridBackground({ maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)' });

		expect(grid?.getAttribute('style')).toContain('mask-image: linear-gradient(to bottom, black 40%, transparent 100%)');
	});
});
