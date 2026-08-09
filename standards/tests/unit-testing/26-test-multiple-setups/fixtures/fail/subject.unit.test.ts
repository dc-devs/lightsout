import { expect, describe, test } from '@jest/globals';
import { getLabel } from './index';

const setupLabel = ({ name = 'Ada' }: { name?: string } = {}) => {
	return { name };
};

const setupFallbackLabel = () => {
	return { name: '' };
};

describe('getLabel', () => {
	test('trims the name it is given', () => {
		const { name } = setupLabel({ name: ' Ada ' });
		const fallback = setupFallbackLabel();

		const label = getLabel({ name: name || fallback.name });

		expect(label).toBe('Ada');
	});
});
