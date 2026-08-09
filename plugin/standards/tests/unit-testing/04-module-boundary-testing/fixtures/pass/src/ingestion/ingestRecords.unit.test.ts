import { expect, describe, test } from '@jest/globals';
import { ingestRecords } from './index';

describe('ingestRecords', () => {
	test('normalizes every record it is given', () => {
		const records = ingestRecords({ raw: [' a ', ' b '] });

		expect(records).toStrictEqual(['a', 'b']);
	});
});
