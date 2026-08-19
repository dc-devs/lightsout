import { expect, describe, test } from '@jest/globals';
import { formatQuote } from './formatQuote';

const setupQuote = ({ text = 'plain' }: { text?: string } = {}) => {
	return { text };
};

// The apostrophe inside the regex literal once opened a phantom string that
// merged both tests into one block, so their single setups counted as two.
describe('formatQuote', () => {
	test("keeps a typo'd word exactly as written", () => {
		const { text } = setupQuote({ text: "typo'd" });

		expect(formatQuote({ text })).toMatch(/typo'd word stays/);
	});

	test('wraps plain text in quotes', () => {
		const { text } = setupQuote();

		expect(formatQuote({ text })).toBe("'plain'");
	});
});
