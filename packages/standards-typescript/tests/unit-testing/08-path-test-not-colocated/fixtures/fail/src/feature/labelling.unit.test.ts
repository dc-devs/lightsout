import { expect, describe, test } from '@jest/globals';
import { getLabel } from './index';

describe('getLabel', () => {
	test('trims the name it is given', () => {
		const label = getLabel({ name: ' Ada ' });

		expect(label).toBe('Ada');
	});
});
