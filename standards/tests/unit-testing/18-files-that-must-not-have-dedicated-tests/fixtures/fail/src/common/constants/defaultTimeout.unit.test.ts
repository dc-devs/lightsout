import { expect, describe, test } from '@jest/globals';
import { defaultTimeout } from './defaultTimeout';

// A literal value with no runtime logic — this test restates the constant and
// pins nothing a consumer could break.
describe('defaultTimeout', () => {
	test('is thirty seconds', () => {
		expect(defaultTimeout).toBe(30_000);
	});
});
