import { expect, test } from '@jest/globals';
import { paint } from '@/cli/common/terminal/paint';

test('paint: no-op when stdout is not a TTY, wraps with the ANSI code when it is', () => {
	const original = process.stdout.isTTY;

	try {
		process.stdout.isTTY = false;
		expect(paint({ code: '32' })('hi')).toBe('hi');

		process.stdout.isTTY = true;
		expect(paint({ code: '32' })('hi')).toBe('\u001b[32mhi\u001b[0m');
	} finally {
		process.stdout.isTTY = original;
	}
});
