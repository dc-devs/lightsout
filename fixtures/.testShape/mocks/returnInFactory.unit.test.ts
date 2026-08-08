import { expect, describe, test, jest } from '@jest/globals';

const mockGetVersion = jest.fn<() => string>();

const setupVersion = () => {
	mockGetVersion.mockReturnValue('1.0.0');

	return { version: '1.0.0' };
};

describe('returnInFactory', () => {
	test('reads the version', () => {
		const { version } = setupVersion();

		expect(mockGetVersion()).toBe(version);
	});
});
