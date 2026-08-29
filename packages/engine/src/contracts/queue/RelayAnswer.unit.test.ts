import { describe, expect, test } from '@jest/globals';
import { RelayAnswer } from '#src/contracts/index.ts';

describe('RelayAnswer', () => {
	test('accepts the object a reader writes beside the question', () => {
		expect(RelayAnswer.parse({ answer: 'the second one' })).toStrictEqual({ answer: 'the second one' });
	});

	test('refuses a bare string, so the file stays self-describing and can grow a field later', () => {
		expect(RelayAnswer.safeParse('the second one').success).toBe(false);
	});

	test('refuses a file with no answer in it at all', () => {
		expect(RelayAnswer.safeParse({}).success).toBe(false);
	});
});
