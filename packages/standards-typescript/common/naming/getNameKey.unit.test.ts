import { describe, expect, test } from '@jest/globals';
import { getNameKey } from './getNameKey.ts';

describe('getNameKey', () => {
	test.each([
		{ name: 'getUserData', synonym: 'get' },
		{ name: 'fetchUserData', synonym: 'fetch' },
		{ name: 'loadUserData', synonym: 'load' },
		{ name: 'retrieveUserData', synonym: 'retrieve' },
		{ name: 'readUserData', synonym: 'read' },
	])('collapses $synonym onto get, so $name keys as "data get user"', ({ name }) => {
		const key = getNameKey({ name });

		expect(key).toBe('data get user');
	});

	test.each([
		{ name: 'makeReport', expected: 'create report' },
		{ name: 'generateReport', expected: 'create report' },
		{ name: 'produceReport', expected: 'create report' },
		{ name: 'createReport', expected: 'create report' },
		{ name: 'removeSession', expected: 'delete session' },
		{ name: 'deleteSession', expected: 'delete session' },
		{ name: 'modifySession', expected: 'session update' },
		{ name: 'updateSession', expected: 'session update' },
		{ name: 'verifyToken', expected: 'token validate' },
		{ name: 'checkToken', expected: 'token validate' },
		{ name: 'validateToken', expected: 'token validate' },
	])('collapses $name onto "$expected"', ({ name, expected }) => {
		const key = getNameKey({ name });

		expect(key).toBe(expected);
	});

	test('ignores word order, so a name reshuffled around its verb keys the same', () => {
		const key = getNameKey({ name: 'userDataGet' });

		expect(key).toBe('data get user');
	});

	test.each([{ name: 'get-user-data' }, { name: 'get_user_data' }, { name: 'user.data.get' }])('reads $name through its separators', ({ name }) => {
		const key = getNameKey({ name });

		expect(key).toBe('data get user');
	});

	test.each([
		{ name: 'hexToRgb', expected: 'hex to rgb' },
		{ name: 'rgbToHex', expected: 'rgb to hex' },
		{ name: 'fromHexColor', expected: 'from hex color' },
	])('pins word order on $name, so opposite directions stay two concepts', ({ name, expected }) => {
		const key = getNameKey({ name });

		expect(key).toBe(expected);
	});

	test('leaves two unrelated names apart', () => {
		const key = getNameKey({ name: 'getUserData' });

		expect(key).not.toBe(getNameKey({ name: 'getUserRoles' }));
	});
});
