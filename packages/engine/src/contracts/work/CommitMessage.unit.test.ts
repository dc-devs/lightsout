import { describe, expect, test } from '@jest/globals';
import { CommitMessage } from '#src/contracts/index.ts';

const setupAnswers = () => {
	const shortest = { summary: 'a' };
	const longest = { summary: 'x'.repeat(64) };
	const withBody = { summary: 'add the widget', body: 'b'.repeat(1200) };

	return { shortest, longest, withBody };
};

const setupRefusedAnswers = () => {
	const empty = { summary: '' };
	const tooLong = { summary: 'x'.repeat(65) };
	const twoLines = { summary: 'add the widget\nand the gadget' };
	const bodyTooLong = { summary: 'add the widget', body: 'b'.repeat(1201) };

	return { empty, tooLong, twoLines, bodyTooLong };
};

describe('CommitMessage', () => {
	test('CommitMessage: accepts a one-line summary of 1 to 64 characters with or without a body of up to 1200 characters', () => {
		const { shortest, longest, withBody } = setupAnswers();

		const accepted = [shortest, longest, withBody].map((answer) => CommitMessage.parse(answer));

		// the shortest and longest summaries, and a summary with the longest body,
		// each pass the boundary unchanged
		expect(accepted).toStrictEqual([{ summary: 'a' }, { summary: 'x'.repeat(64) }, { summary: 'add the widget', body: 'b'.repeat(1200) }]);
	});

	test('CommitMessage: refuses an empty summary, a 65-character summary, a summary holding a line break and a 1201-character body', () => {
		const { empty, tooLong, twoLines, bodyTooLong } = setupRefusedAnswers();

		const refused = [empty, tooLong, twoLines, bodyTooLong].map((answer) => CommitMessage.safeParse(answer).success);

		// each off-shape answer is refused at the boundary, so it reaches the re-emit
		// rung and then the template fallback rather than a commit
		expect(refused).toStrictEqual([false, false, false, false]);
	});
});
