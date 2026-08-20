import { expect, test } from '@jest/globals';
import { formatElapsed } from '#src/common/utils/formatElapsed.ts';

for (const { elapsedMs, expected } of [
	{ elapsedMs: 0, expected: '0s' },
	{ elapsedMs: 45_000, expected: '45s' },
	{ elapsedMs: 59_400, expected: '59s' },
	{ elapsedMs: 59_600, expected: '1m00s' },
	{ elapsedMs: 90_000, expected: '1m30s' },
	{ elapsedMs: 725_000, expected: '12m05s' },
	{ elapsedMs: 3_600_000, expected: '60m00s' },
]) {
	test(`formatElapsed: ${elapsedMs}ms reads as ${expected}`, () => {
		expect(formatElapsed({ elapsedMs })).toBe(expected);
	});
}
