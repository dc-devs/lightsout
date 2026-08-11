import { expect, describe, test } from '@jest/globals';
import { getTimeout } from './getTimeout';

describe('getTimeout', () => {
	test('falls back to the default when no override is given', () => {
		const timeout = getTimeout({});

		expect(timeout).toBe(30_000);
	});
});
