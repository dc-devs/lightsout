import { describe, expect, test } from '@jest/globals';
import { parseDurationMs } from '#src/queue/common/utils/parseDurationMs.ts';

describe('parseDurationMs', () => {
	test('reads each accepted unit, so a value carries its own granularity and no key has to spell one', () => {
		expect(parseDurationMs({ value: '90s', key: 'queue.question-timeout' })).toBe(90_000);
		expect(parseDurationMs({ value: '45m', key: 'queue.question-timeout' })).toBe(2_700_000);
		expect(parseDurationMs({ value: '4h', key: 'queue.worker-timeout' })).toBe(14_400_000);
	});

	test('ignores the whitespace a hand-edited config carries', () => {
		expect(parseDurationMs({ value: '  30m  ', key: 'queue.worker-timeout' })).toBe(1_800_000);
	});

	test('names the key and the accepted forms rather than guessing a unit', () => {
		expect(parseDurationMs({ value: '240', key: 'queue.worker-timeout' })).toStrictEqual({
			error: "`queue.worker-timeout` must be a duration like '90s', '45m' or '4h' — got '240'",
		});
	});

	test('refuses a unit it has no meaning for, because a silently ignored ceiling is worse than a refusal', () => {
		expect(parseDurationMs({ value: '2d', key: 'queue.worker-timeout' })).toMatchObject({ error: expect.stringContaining("got '2d'") });
		expect(parseDurationMs({ value: '1.5h', key: 'queue.worker-timeout' })).toMatchObject({ error: expect.stringContaining("got '1.5h'") });
		expect(parseDurationMs({ value: '', key: 'queue.worker-timeout' })).toMatchObject({ error: expect.stringContaining("got ''") });
	});

	test('refuses a zero duration — a ceiling nothing can fit under is a configuration mistake, not a policy', () => {
		expect(parseDurationMs({ value: '0h', key: 'queue.worker-timeout' })).toMatchObject({ error: expect.stringContaining("got '0h'") });
	});
});
