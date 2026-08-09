import { expect, describe, test } from '@jest/globals';
import { normalizeRecord } from './normalizeRecord';

// A dedicated test on a module internal, deep-imported past the barrel — the
// coverage belongs to the boundary that owns it.
describe('normalizeRecord', () => {
	test('trims the record it is given', () => {
		const record = normalizeRecord({ raw: ' a ' });

		expect(record).toBe('a');
	});
});
