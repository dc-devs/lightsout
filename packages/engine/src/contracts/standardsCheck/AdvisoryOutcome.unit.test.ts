import { describe, expect, test } from '@jest/globals';
import { AdvisoryOutcome } from '#src/contracts/index.ts';

const setupOutcome = (overrides: Record<string, unknown> = {}) => {
	const outcome = { rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'declined', reason: 'orchestration exemption applies', ...overrides };

	return { outcome };
};

describe('AdvisoryOutcome', () => {
	test('a decline parses with the rule, the site and the reason a reader needs', () => {
		const { outcome } = setupOutcome();

		expect(AdvisoryOutcome.parse(outcome)).toStrictEqual(outcome);
	});

	test('an applied entry needs no reason — there is nothing to explain about taking the advice', () => {
		const outcome = { rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'applied' };

		expect(AdvisoryOutcome.parse(outcome)).toStrictEqual(outcome);
	});

	test('outcome accepts each of the two answers the health report has a column for', () => {
		for (const answer of ['applied', 'declined']) {
			expect(AdvisoryOutcome.safeParse(setupOutcome({ outcome: answer }).outcome).success).toBe(true);
		}
	});

	test('outcome accepts nothing beyond those two answers', () => {
		for (const answer of ['Applied', 'skipped', 'partial', true]) {
			// an invented answer would land in neither column of the health report
			expect(AdvisoryOutcome.safeParse(setupOutcome({ outcome: answer }).outcome).success).toBe(false);
		}
	});

	test('the rule and the site key are required — an answer nobody can attribute is not an answer', () => {
		for (const field of ['rule', 'siteKey']) {
			expect(AdvisoryOutcome.safeParse(setupOutcome({ [field]: undefined }).outcome).success).toBe(false);
		}
	});

	test('the rest of the finding the agent echoed back is dropped, leaving only what the record keeps', () => {
		const { outcome } = setupOutcome();

		const parsed = AdvisoryOutcome.parse({ ...outcome, severity: 'advisory', file: 'src/a.ts', detail: 'the function runs long' });

		// the agent is shown a whole finding and may echo more of it than it was
		// asked for; the persisted entry is the four declared fields, nothing more
		expect(parsed).toStrictEqual({ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'declined', reason: 'orchestration exemption applies' });
	});

	test('a reason that is not a sentence is refused rather than printed as one', () => {
		const { outcome } = setupOutcome({ reason: 42 });

		const result = AdvisoryOutcome.safeParse(outcome);

		// the health report prints this string verbatim beneath the rule
		expect(result.success).toBe(false);
	});

	test('refuses an entry that is not an object at all', () => {
		for (const value of [undefined, null, 'declined', ['declined']]) {
			// entries arrive inside a persisted report read back from disk — a
			// non-object must fail rather than throw or count as a decline
			expect(AdvisoryOutcome.safeParse(value).success).toBe(false);
		}
	});
});
