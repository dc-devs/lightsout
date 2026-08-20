import { describe, expect, test } from '@jest/globals';
import { isRecord } from './isRecord.ts';

describe('isRecord', () => {
	test.each([
		{ shape: 'an object literal', value: { imports: {} }, expected: true },
		{ shape: 'an empty object', value: {}, expected: true },
		{ shape: 'an array, whose keys are not the ones a caller means', value: ['./src/*'], expected: false },
		{ shape: 'null, which typeof calls an object', value: null, expected: false },
		{ shape: 'a string', value: './src/*', expected: false },
		{ shape: 'a number', value: 1, expected: false },
		{ shape: 'undefined', value: undefined, expected: false },
	])('answers $expected for $shape', ({ value, expected }) => {
		expect(isRecord(value)).toBe(expected);
	});
});
