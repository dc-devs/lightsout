import { expect, describe, test, beforeEach } from '@jest/globals';
import { getLabel } from './index';

// A NEW test file written in the legacy style of the file it mirrors — this
// document wins for files you create, whatever the mirror target does.
let name: string;

describe('getLabel', () => {
	beforeEach(() => {
		name = ' Ada ';
	});

	test('trims the name it is given', () => {
		expect(getLabel({ name })).toBe('Ada');
	});
});
