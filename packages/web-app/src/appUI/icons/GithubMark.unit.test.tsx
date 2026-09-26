import { describe, expect, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { GithubMark } from '#src/appUI/icons/GithubMark.tsx';

describe('GithubMark', () => {
	test('is hidden from assistive technology, since the link around it names itself', () => {
		const { container } = render(<GithubMark />);

		expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
	});

	test('draws in the text colour, so it follows the theme', () => {
		const { container } = render(<GithubMark />);

		expect(container.firstElementChild).toHaveAttribute('fill', 'currentColor');
	});

	test('takes a class from the control it sits in', () => {
		const { container } = render(<GithubMark className="size-4" />);

		expect(container.firstElementChild).toHaveClass('size-4');
	});
});
