import { expect, describe, test } from '@jest/globals';
import { getLabel } from './index';

describe('getLabel', () => {
	describe('when the name is padded', () => {
		test('trims it', () => {
			const label = getLabel({ name: ' Ada ' });

			expect(label).toBe('Ada');
		});
	});
});
