import { expect, describe, test } from '@jest/globals';
import { normalizeRecord } from './normalizeRecord';

// A dedicated test on a trivial internal whose exact behavior the boundary
// test beside it already pins — duplicate coverage, not a file that earned a
// direct test.
describe('normalizeRecord', () => {
	test('trims the record it is given', () => {
		const record = normalizeRecord({ raw: ' a ' });

		expect(record).toBe('a');
	});
});
