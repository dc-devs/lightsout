import { expect, describe, test, jest } from '@jest/globals';

const setupProfile = () => {
	const getProfile = jest.fn<() => string>();

	getProfile.mockReturnValue('p.png');

	return { getProfile };
};

describe('factoryLocalMock', () => {
	test('reads the profile', () => {
		const { getProfile } = setupProfile();

		expect(getProfile()).toBe('p.png');
	});
});
