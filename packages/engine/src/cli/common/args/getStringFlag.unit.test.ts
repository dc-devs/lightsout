import { expect, test } from '@jest/globals';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { parseFlags } from '@/cli/common/args/parseFlags';

test('getStringFlag: returns the string value, undefined for a boolean flag, undefined when absent', () => {
	const flags = parseFlags({ args: ['--name', 'bar', '--all'] });

	expect(getStringFlag({ flags, name: 'name' })).toBe('bar');
	expect(getStringFlag({ flags, name: 'all' })).toBe(undefined);
	expect(getStringFlag({ flags, name: 'missing' })).toBe(undefined);
});
