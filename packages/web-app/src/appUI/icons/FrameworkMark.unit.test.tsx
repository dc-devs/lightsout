import { describe, expect, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { FrameworkMark } from '#src/appUI/icons/FrameworkMark.tsx';
import { Framework } from '#src/common/constants/Framework.ts';

describe('FrameworkMark', () => {
	test.each([
		{ framework: Framework.TypeScript, color: '#3178C6' },
		{ framework: Framework.React, color: '#61DAFB' },
		{ framework: Framework.TanStack, color: 'currentColor' },
	])('draws $framework in a colour that shows on either theme', ({ framework, color }) => {
		const { container } = render(<FrameworkMark framework={framework} />);

		expect(container.firstElementChild).toHaveAttribute('fill', color);
	});

	test('is hidden from assistive technology, since its box names the framework', () => {
		const { container } = render(<FrameworkMark framework={Framework.React} className="size-5" />);

		expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
	});
});
