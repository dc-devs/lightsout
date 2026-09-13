import { describe, expect, test } from '@jest/globals';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';

describe('planNumberOf', () => {
	test.each([
		{ id: '001-search-basics', expected: 1 },
		{ id: '002-queue-order', expected: 2 },
		{ id: '010-ship-guard', expected: 10 },
		{ id: '999-the-last-one', expected: 999 },
	])('reads $expected out of the three digits $id leads with', ({ id, expected }) => {
		const number = planNumberOf({ id });

		expect(number).toBe(expected);
	});

	test('answers NaN for an id that does not lead with digits, which compares false against every number', () => {
		const number = planNumberOf({ id: 'abc-search' });

		expect({ number, belowOne: number < 1, aboveOne: number > 1 }).toStrictEqual({ number: Number.NaN, belowOne: false, aboveOne: false });
	});
});
