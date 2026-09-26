import { describe, expect, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { JiraMark } from '#src/appUI/icons/JiraMark.tsx';

describe('JiraMark', () => {
	test('draws in Jira’s own blue, so it reads as Jira at a glance', () => {
		const { container } = render(<JiraMark />);

		expect(container.firstElementChild).toHaveAttribute('fill', '#2684FF');
	});

	test('is hidden from assistive technology, since the words beside it name Jira', () => {
		const { container } = render(<JiraMark />);

		expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
	});

	test('takes a class from where it sits', () => {
		const { container } = render(<JiraMark className="size-4" />);

		expect(container.firstElementChild).toHaveClass('size-4');
	});
});
