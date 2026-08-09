import { expect, describe, test, jest } from '@jest/globals';
import { getUserData } from './index';

const mockFindUser = jest.fn<(id: string) => Promise<{ id: string } | null>>();

const setupUser = ({ found = true }: { found?: boolean } = {}) => {
	if (found) {
		mockFindUser.mockResolvedValue({ id: '1' });
	} else {
		mockFindUser.mockRejectedValue(new Error('Not found'));
	}

	return { findUser: mockFindUser };
};

describe('getUserData', () => {
	test('rejects when the user does not exist', async () => {
		const { findUser } = setupUser({ found: false });

		await expect(getUserData({ findUser, userId: '999' })).rejects.toThrow('Not found');
	});
});
