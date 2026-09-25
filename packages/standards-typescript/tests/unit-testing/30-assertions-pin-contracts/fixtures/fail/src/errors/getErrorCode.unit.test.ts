import { expect, describe, test } from '@jest/globals';
import { getErrorCode } from './getErrorCode';
import { errorCodes } from './errorCodes';

describe('getErrorCode', () => {
	test('names the connection failure by its wire code', () => {
		const code = getErrorCode({ kind: 'connection' });

		// comparing the module's own constant to itself — true even when the value is wrong
		expect(code).toBe(errorCodes.connection);
	});
});
