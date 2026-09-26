import { describe, expect, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { CodeSpans } from '#src/features/packs/screens/RuleSetPage/internal/components/CodeSpans.tsx';

describe('CodeSpans', () => {
	test('draws each backticked word as code, without its backticks', () => {
		const { container } = render(<CodeSpans text="an `as` cast where `narrowing` would do" />);

		expect([...container.querySelectorAll('code')].map((code) => code.textContent)).toStrictEqual(['as', 'narrowing']);
	});

	test('keeps the words around them as they were written', () => {
		const { container } = render(<CodeSpans text="an `as` cast" />);

		expect(container.textContent).toBe('an as cast');
	});

	test('leaves a line with no backticks as plain text', () => {
		const { container } = render(<CodeSpans text="two modules that import each other" />);

		expect(container.querySelectorAll('code')).toHaveLength(0);
	});

	test('keeps a lone backtick as the character it is, rather than an empty code span', () => {
		const { container } = render(<CodeSpans text="a stray ` mark" />);

		expect({ text: container.textContent, code: container.querySelectorAll('code').length }).toStrictEqual({ text: 'a stray ` mark', code: 0 });
	});
});
