import { expect, describe, test } from '@jest/globals';
import { getNameKey } from './getNameKey.ts';

describe('getNameKey', () => {
	test.each([
		{ name: 'fetchUserData', synonym: 'fetch' },
		{ name: 'loadUserData', synonym: 'load' },
		{ name: 'retrieveUserData', synonym: 'retrieve' },
		{ name: 'readUserData', synonym: 'read' },
	])('collapses $synonym onto get, so $name keys the same as getUserData', ({ name }) => {
		expect(getNameKey({ name })).toBe(getNameKey({ name: 'getUserData' }));
	});

	test.each([
		{ name: 'makeReport', canonical: 'createReport' },
		{ name: 'generateReport', canonical: 'createReport' },
		{ name: 'produceReport', canonical: 'createReport' },
		{ name: 'removeSession', canonical: 'deleteSession' },
		{ name: 'modifySession', canonical: 'updateSession' },
		{ name: 'verifyToken', canonical: 'validateToken' },
		{ name: 'checkToken', canonical: 'validateToken' },
	])('collapses $name onto $canonical', ({ name, canonical }) => {
		expect(getNameKey({ name })).toBe(getNameKey({ name: canonical }));
	});

	test('ignores word order, so a name reshuffled around its verb keys the same', () => {
		expect(getNameKey({ name: 'userDataGet' })).toBe(getNameKey({ name: 'getUserData' }));
	});

	test.each([
		{ name: 'get-user-data' },
		{ name: 'get_user_data' },
		{ name: 'user.data.get' },
	])('reads $name through its separators', ({ name }) => {
		expect(getNameKey({ name })).toBe(getNameKey({ name: 'getUserData' }));
	});

	test('pins word order on a conversion, so opposite directions stay two concepts', () => {
		expect(getNameKey({ name: 'hexToRgb' })).not.toBe(getNameKey({ name: 'rgbToHex' }));
	});

	test('pins word order on a from-conversion for the same reason', () => {
		expect(getNameKey({ name: 'fromHexColor' })).toBe('from hex color');
	});

	test('leaves two unrelated names apart', () => {
		expect(getNameKey({ name: 'getUserData' })).not.toBe(getNameKey({ name: 'getUserRoles' }));
	});
});
