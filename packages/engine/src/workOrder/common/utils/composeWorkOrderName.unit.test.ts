import { describe, expect, test } from '@jest/globals';
import { composeWorkOrderName } from '#src/workOrder/common/utils/composeWorkOrderName.ts';

describe('composeWorkOrderName', () => {
	test('composeWorkOrderName: lowercases the ticket reference and joins it to the slugged words with one hyphen', () => {
		const answer = composeWorkOrderName({ ticketRef: 'LO-158', words: 'Give The Name One' });

		expect(answer).toStrictEqual({ name: 'lo-158-give-the-name-one' });
	});

	test('composeWorkOrderName: with no ticket reference the label is the slugged words alone, and words that slug to nothing are refused', () => {
		const answers = {
			words: composeWorkOrderName({ words: 'Add Search Basics' }),
			nothing: composeWorkOrderName({ words: '???' }),
		};

		expect(answers).toEqual({
			words: { name: 'add-search-basics' },
			nothing: { error: expect.any(String) },
		});
	});

	test('composeWorkOrderName: strips a slash, spaces and uppercase from the words, so a label is always one path segment', () => {
		const answer = composeWorkOrderName({ ticketRef: 'LO-158', words: 'Feature/Add Search Basics' });

		expect(answer).toStrictEqual({ name: 'lo-158-feature-add-search-basics' });
	});
});
