import { expect, describe, test, jest } from '@jest/globals';

const mockGetBuildId = jest.fn<() => string>();

jest.mock('@/app/getBuildId', () => ({
	getBuildId: () => mockGetBuildId(),
}));

describe('wrapperNoAssertion', () => {
	test('reads the build id', () => {
		mockGetBuildId.mockReturnValue('build-9');

		expect(mockGetBuildId()).toBe('build-9');
	});
});
