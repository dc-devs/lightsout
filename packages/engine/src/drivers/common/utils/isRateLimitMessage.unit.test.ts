import { expect, test } from '@jest/globals';
import { isRateLimitMessage } from '#src/drivers/common/utils/isRateLimitMessage.ts';

test('isRateLimitMessage: the period-qualified wording the harness really used is read as a wall', () => {
	// the exact rejected payload from the 2026-08-25 graded pass, which the two
	// hand-written driver lists both missed
	expect(isRateLimitMessage({ text: "You've hit your weekly limit · resets 4am" })).toBe(true);
});

test('isRateLimitMessage: a limit qualified by any period is a wall', () => {
	expect(isRateLimitMessage({ text: 'you have reached your daily limit' })).toBe(true);
	expect(isRateLimitMessage({ text: 'hourly limit exceeded' })).toBe(true);
	expect(isRateLimitMessage({ text: 'monthly limit exceeded' })).toBe(true);
});

test('isRateLimitMessage: the "hit your … limit" phrasing is a wall whatever period names it', () => {
	expect(isRateLimitMessage({ text: "You've hit your 5-hour limit" })).toBe(true);
});

test('isRateLimitMessage: every wording the two driver lists already caught still reads as a wall', () => {
	expect(isRateLimitMessage({ text: 'Claude usage limit reached, resets at 5pm' })).toBe(true);
	expect(isRateLimitMessage({ text: 'error: rate limit exceeded' })).toBe(true);
	expect(isRateLimitMessage({ text: 'limit reached' })).toBe(true);
	expect(isRateLimitMessage({ text: 'your limit will reset at midnight' })).toBe(true);
	expect(isRateLimitMessage({ text: 'quota exhausted' })).toBe(true);
	expect(isRateLimitMessage({ text: 'API Error: 529 overloaded' })).toBe(true);
	expect(isRateLimitMessage({ text: 'the upstream is overloaded' })).toBe(true);
});

test('isRateLimitMessage: an ordinary harness failure is not a wall', () => {
	expect(isRateLimitMessage({ text: 'boom: unrecognized flag' })).toBe(false);
});

test('isRateLimitMessage: a bare 529 unqualified by status, error or code is not a wall', () => {
	// a token count, a cost or a line number would otherwise park the run
	expect(isRateLimitMessage({ text: 'wrote 529 tokens to the report' })).toBe(false);
});

test('isRateLimitMessage: a limit with no period and no "hit your" phrasing is not a wall', () => {
	expect(isRateLimitMessage({ text: 'the plan has no limit on how many phases it declares' })).toBe(false);
});
