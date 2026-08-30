import { describe, expect, test } from '@jest/globals';
import { ProgressRecord } from '#src/contracts/index.ts';

const setupRecord = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const record: Record<string, unknown> = { at: '2026-01-01T00:00:00.000Z', message: 'step refactor — pass 1/3', ...extra };

	if (omit) {
		delete record[omit];
	}

	return { record };
};

describe('ProgressRecord', () => {
	test('a narrated line parses to exactly the timestamp and the message', () => {
		const { record } = setupRecord();

		expect(ProgressRecord.parse(record)).toStrictEqual({ at: '2026-01-01T00:00:00.000Z', message: 'step refactor — pass 1/3' });
	});

	test('at and message are each required — a line missing either cannot be quoted back', () => {
		for (const field of ['at', 'message']) {
			const { record } = setupRecord({ omit: field });

			expect(ProgressRecord.safeParse(record).success).toBe(false);
		}
	});

	test('an empty message parses — a run that narrated a blank line still narrated one', () => {
		const { record } = setupRecord({ extra: { message: '' } });

		expect(ProgressRecord.parse(record).message).toBe('');
	});

	test('a non-string message is refused rather than coerced', () => {
		const { record } = setupRecord({ extra: { message: 7 } });

		// the `now` line prints this verbatim; a number would reach a reader as one
		expect(ProgressRecord.safeParse(record).success).toBe(false);
	});
});
