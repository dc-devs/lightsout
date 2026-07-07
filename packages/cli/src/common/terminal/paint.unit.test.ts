import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paint } from './paint';

test('paint: no-op when stdout is not a TTY, wraps with the ANSI code when it is', () => {
	const original = process.stdout.isTTY;

	try {
		process.stdout.isTTY = false;
		assert.equal(paint({ code: '32' })('hi'), 'hi');

		process.stdout.isTTY = true;
		assert.equal(paint({ code: '32' })('hi'), '\u001b[32mhi\u001b[0m');
	} finally {
		process.stdout.isTTY = original;
	}
});
