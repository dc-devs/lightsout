import { describe, expect, test } from '@jest/globals';
import { getNameKey } from '#src/plan/common/naming/getNameKey.ts';

describe('getNameKey', () => {
	test.each([
		{ name: 'getUserData', expected: 'data get user' },
		{ name: 'fetchUserData', expected: 'data get user' },
		{ name: 'retrieveUserData', expected: 'data get user' },
		{ name: 'userDataGet', expected: 'data get user' },
	])('reads $name as "$expected", so a synonym verb or a shuffled word order is the same key', ({ name, expected }) => {
		const key = getNameKey({ name });

		expect(key).toBe(expected);
	});

	test.each([
		{ name: 'makeThing', expected: 'create thing' },
		{ name: 'createThing', expected: 'create thing' },
		{ name: 'verify-facts', expected: 'facts validate' },
		{ name: 'remove_stale.entry', expected: 'delete entry stale' },
	])('canonicalizes the verb and lowercases the tokens, so $name reads as "$expected"', ({ name, expected }) => {
		const key = getNameKey({ name });

		expect(key).toBe(expected);
	});

	test.each([
		{ name: 'hexToRgb', expected: 'hex to rgb' },
		{ name: 'rgbToHex', expected: 'rgb to hex' },
		{ name: 'dtoFromEntity', expected: 'dto from entity' },
		{ name: 'entityFromDto', expected: 'entity from dto' },
	])('keeps $name in its written order, since a conversion and its opposite are two concepts', ({ name, expected }) => {
		const key = getNameKey({ name });

		expect(key).toBe(expected);
	});
});
