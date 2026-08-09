import { expect, describe, test } from '@jest/globals';
import { getLabel } from './index';

describe('getLabel', () => {
	describe('padded names', () => {
		test('trims it', () => {
			const label = getLabel({ name: ' Ada ' });

			expect(label).toBe('Ada');
		});
	});
});
