import { expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';

test('parseFlags: pairs a flag with its value, and treats a flag with no value (or one followed by another flag) as boolean true', () => {
	const flags = parseFlags({ args: ['--plan', 'p.md', '--skip-refactor', '--cwd', '/x'] });

	expect(flags.get('plan')).toBe('p.md');
	expect(flags.get('skip-refactor')).toBe(true);
	expect(flags.get('cwd')).toBe('/x');
	expect(flags.size).toBe(3);
});

test('parseFlags: a trailing boolean flag is true; positionals are not captured', () => {
	const flags = parseFlags({ args: ['foo', '--name', 'bar', 'baz', '--all'] });

	expect(flags.get('name')).toBe('bar');
	expect(flags.get('all')).toBe(true);
	expect(flags.has('foo')).toBe(false);
	expect(flags.has('baz')).toBe(false);
});
