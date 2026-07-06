import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPositionals } from '../src/common/args/getPositionals';
import { getStringFlag } from '../src/common/args/getStringFlag';
import { parseFlags } from '../src/common/args/parseFlags';
import { formatDuration } from '../src/common/formatting/formatDuration';
import { formatTokenCount } from '../src/common/formatting/formatTokenCount';
import { paint } from '../src/common/terminal/paint';

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

test('getPositionals: keeps bare tokens and skips a flag together with the value it consumes', () => {
	assert.deepEqual(getPositionals({ args: ['somenode', '--rescan', '--cwd', '/x'] }), ['somenode']);
	assert.deepEqual(getPositionals({ args: ['verify', 'doc-1', 'doc-2', '--repair'] }), ['verify', 'doc-1', 'doc-2']);
	assert.deepEqual(getPositionals({ args: ['--name', 'bar', 'baz'] }), ['baz']);
	assert.deepEqual(getPositionals({ args: [] }), []);
});

test('getStringFlag: returns the string value, undefined for a boolean flag, undefined when absent', () => {
	const flags = parseFlags({ args: ['--name', 'bar', '--all'] });

	assert.equal(getStringFlag({ flags, name: 'name' }), 'bar');
	assert.equal(getStringFlag({ flags, name: 'all' }), undefined);
	assert.equal(getStringFlag({ flags, name: 'missing' }), undefined);
});

test('formatDuration: em-dash for undefined, bare seconds under a minute, padded m/s at or above', () => {
	assert.equal(formatDuration({ ms: undefined }), '—');
	assert.equal(formatDuration({ ms: 5400 }), '5s');
	assert.equal(formatDuration({ ms: 60000 }), '1m 00s');
	assert.equal(formatDuration({ ms: 65000 }), '1m 05s');
	assert.equal(formatDuration({ ms: 125000 }), '2m 05s');
});

test('formatTokenCount: raw under 1k, one-decimal k under 1M, one-decimal M above', () => {
	assert.equal(formatTokenCount({ count: 500 }), '500');
	assert.equal(formatTokenCount({ count: 1000 }), '1.0k');
	assert.equal(formatTokenCount({ count: 1500 }), '1.5k');
	assert.equal(formatTokenCount({ count: 1_000_000 }), '1.0M');
	assert.equal(formatTokenCount({ count: 2_500_000 }), '2.5M');
});

test('paint: no-op when stdout is not a TTY, wraps with the ANSI code when it is', () => {
	const original = process.stdout.isTTY;

	try {
		process.stdout.isTTY = false;
		assert.equal(paint({ code: '32' })('hi'), 'hi');

		process.stdout.isTTY = true;
		assert.equal(paint({ code: '32' })('hi'), '\\u001b[32mhi\\u001b[0m');
	} finally {
		process.stdout.isTTY = original;
	}
});
