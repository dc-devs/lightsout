import { expect, describe, test } from '@jest/globals';
import { getLabel } from './getLabel';

const setupLabel = ({ name = ' Ada ' }: { name?: string } = {}) => {
	return { name };
};

describe('getLabel', () => {
	test('trims the name it is given', () => {
		const { name } = setupLabel();

		const label = getLabel({ name });

		expect(label).toBe('Ada');
	});
});
