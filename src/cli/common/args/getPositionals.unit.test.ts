import { expect, test } from '@jest/globals';
import { getPositionals } from '@/cli/common/args/getPositionals';

test('getPositionals: keeps bare tokens and skips a flag together with the value it consumes', () => {
	expect(getPositionals({ args: ['somenode', '--rescan', '--cwd', '/x'] })).toStrictEqual(['somenode']);
	expect(getPositionals({ args: ['scan', 'doc-1', 'doc-2', '--repair'] })).toStrictEqual(['scan', 'doc-1', 'doc-2']);
	expect(getPositionals({ args: ['--name', 'bar', 'baz'] })).toStrictEqual(['baz']);
	expect(getPositionals({ args: [] })).toStrictEqual([]);
});

test('getPositionals: an empty argv token is dropped rather than returned as a nameless positional', () => {
	expect(getPositionals({ args: ['', 'scan', ''] })).toStrictEqual(['scan']);
});
