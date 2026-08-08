import { expect, describe, test, jest } from '@jest/globals';

const getProfile = jest.fn<() => string>();

describe('unprefixedMock', () => {
	test('reads the profile', () => {
		getProfile.mockReturnValue('p.png');

		expect(getProfile()).toBe('p.png');
	});
});
