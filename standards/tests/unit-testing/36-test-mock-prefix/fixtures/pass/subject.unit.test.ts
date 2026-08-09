import { expect, describe, test, jest } from '@jest/globals';

const mockGetProfile = jest.fn<() => string>();

const setupProfile = () => {
	const getGravatar = jest.fn<() => string>();

	mockGetProfile.mockReturnValue('p.png');
	getGravatar.mockReturnValue('g.png');

	return { getGravatar };
};

describe('subject', () => {
	test('reads the profile', () => {
		const { getGravatar } = setupProfile();

		expect(mockGetProfile() + getGravatar()).toBe('p.pngg.png');
	});
});
