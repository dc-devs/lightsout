import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPositionals } from './getPositionals';

test('getPositionals: keeps bare tokens and skips a flag together with the value it consumes', () => {
	assert.deepEqual(getPositionals({ args: ['somenode', '--rescan', '--cwd', '/x'] }), ['somenode']);
	assert.deepEqual(getPositionals({ args: ['scan', 'doc-1', 'doc-2', '--repair'] }), ['scan', 'doc-1', 'doc-2']);
	assert.deepEqual(getPositionals({ args: ['--name', 'bar', 'baz'] }), ['baz']);
	assert.deepEqual(getPositionals({ args: [] }), []);
});
