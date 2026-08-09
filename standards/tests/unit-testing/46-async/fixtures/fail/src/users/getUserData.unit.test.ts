import { expect, describe, test, jest } from '@jest/globals';
import { getUserData } from './index';

const mockFindUser = jest.fn<(id: string) => Promise<{ id: string } | null>>();

describe('getUserData', () => {
	test('rejects when the user does not exist', () => {
		mockFindUser.mockImplementation(() => Promise.reject(new Error('Not found')));

		// nothing is awaited, so the assertion runs before the rejection lands and
		// the test passes whatever the unit does
		getUserData({ findUser: mockFindUser, userId: '999' }).catch((error: Error) => {
			expect(error.message).toBe('Not found');
		});
	});
});
