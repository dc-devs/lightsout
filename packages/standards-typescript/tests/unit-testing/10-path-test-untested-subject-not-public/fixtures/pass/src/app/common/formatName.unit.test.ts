import { expect, describe, test } from '@jest/globals';
import { formatName } from './formatName';

// A root-layer common file (src/<layer>/common/) is a boundary by the
// classification table: its direct test needs no barrel promotion, even though
// the app barrel above it does not export it.
describe('formatName', () => {
	test('trims the name it is given', () => {
		const name = formatName({ name: ' Ada ' });

		expect(name).toBe('Ada');
	});
});
