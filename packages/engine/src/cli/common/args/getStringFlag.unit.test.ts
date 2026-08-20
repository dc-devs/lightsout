import { expect, test } from '@jest/globals';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';

test('getStringFlag: returns the string value, undefined for a boolean flag, undefined when absent', () => {
	const flags = parseFlags({ args: ['--name', 'bar', '--all'] });

	expect(getStringFlag({ flags, name: 'name' })).toBe('bar');
	expect(getStringFlag({ flags, name: 'all' })).toBe(undefined);
	expect(getStringFlag({ flags, name: 'missing' })).toBe(undefined);
});
