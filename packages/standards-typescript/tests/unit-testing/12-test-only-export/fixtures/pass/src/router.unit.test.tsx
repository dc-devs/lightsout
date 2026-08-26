import { describe, expect, test } from '@jest/globals';
import { getRouter } from './router';

describe('getRouter', () => {
	test('builds a router', () => {
		expect(getRouter()).toBeDefined();
	});
});
