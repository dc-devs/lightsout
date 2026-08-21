import { expect, describe, test } from '@jest/globals';
import { getTimeout } from './index';

// An internal barrel, not the package's published entry. Every file that imports
// through it already proves it resolves, so this test pins nothing — and the
// exception for a published entry does not reach down here.
describe('the utils barrel', () => {
	test('re-exports getTimeout', () => {
		expect(typeof getTimeout).toBe('function');
	});
});
