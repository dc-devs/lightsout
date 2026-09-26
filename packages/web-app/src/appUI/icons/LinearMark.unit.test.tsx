import { describe, expect, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { LinearMark } from '#src/appUI/icons/LinearMark.tsx';

describe('LinearMark', () => {
	test('draws in Linear’s own purple, so it reads as Linear at a glance', () => {
		const { container } = render(<LinearMark />);

		expect(container.firstElementChild).toHaveAttribute('fill', '#5E6AD2');
	});

	test('is hidden from assistive technology, since the words beside it name Linear', () => {
		const { container } = render(<LinearMark />);

		expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
	});

	test('takes a class from where it sits', () => {
		const { container } = render(<LinearMark className="size-4" />);

		expect(container.firstElementChild).toHaveClass('size-4');
	});
});
