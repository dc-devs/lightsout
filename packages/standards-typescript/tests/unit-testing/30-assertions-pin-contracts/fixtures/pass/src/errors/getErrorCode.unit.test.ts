import { expect, describe, test } from '@jest/globals';
import { getErrorCode } from './getErrorCode';

describe('getErrorCode', () => {
	test('names the connection failure by its wire code', () => {
		const code = getErrorCode({ kind: 'connection' });

		expect(code).toBe('ERR_CONNECTION');
	});
});
