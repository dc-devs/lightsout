import { expect, describe, test, jest } from '@jest/globals';

const getProfile = jest.fn<() => string>();

const getSettings = jest.fn<() => string>();

describe('twoUnprefixedMocks', () => {
	test('reads both stubs', () => {
		getProfile.mockReturnValue('p.png');
		getSettings.mockReturnValue('dark');

		expect(getProfile() + getSettings()).toBe('p.pngdark');
	});
});
