import { expect, describe, test } from '@jest/globals';
import * as library from './index';

// The published entry — the file this package names in its `exports` map. No
// test inside this package imports through it, so nothing else here would
// notice a name dropped in a rename or a merge; a consumer's build would.
describe('the package entry', () => {
	test('hands out exactly the surface it publishes', () => {
		expect(Object.keys(library).sort()).toStrictEqual(['defaultTimeout', 'getTimeout']);
	});

	// what each of them DOES is proven by its own test file, not here
	test('every name arrived as a value rather than erasing to undefined', () => {
		expect(Object.values(library).some((entry) => entry === undefined)).toBe(false);
	});
});
