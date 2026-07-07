import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFlags } from './parseFlags';

test('parseFlags: pairs a flag with its value, and treats a flag with no value (or one followed by another flag) as boolean true', () => {
	const flags = parseFlags({ args: ['--plan', 'p.md', '--skip-refactor', '--cwd', '/x'] });

	assert.equal(flags.get('plan'), 'p.md');
	assert.equal(flags.get('skip-refactor'), true);
	assert.equal(flags.get('cwd'), '/x');
	assert.equal(flags.size, 3);
});

test('parseFlags: a trailing boolean flag is true; positionals are not captured', () => {
	const flags = parseFlags({ args: ['foo', '--name', 'bar', 'baz', '--all'] });

	assert.equal(flags.get('name'), 'bar');
	assert.equal(flags.get('all'), true);
	assert.equal(flags.has('foo'), false);
	assert.equal(flags.has('baz'), false);
});
