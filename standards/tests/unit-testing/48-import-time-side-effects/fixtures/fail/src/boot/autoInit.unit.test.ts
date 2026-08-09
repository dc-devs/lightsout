import { expect, describe, test, jest } from '@jest/globals';
import { isInitialized } from './autoInit';

describe('autoInit', () => {
	test('reads the current script the module was loaded from', () => {
		// the module already ran at import time, so this change arrives too late
		// and every later test shares the one instance
		jest.replaceProperty(document, 'currentScript', document.createElement('script'));

		expect(isInitialized).toBe(true);
	});
});
