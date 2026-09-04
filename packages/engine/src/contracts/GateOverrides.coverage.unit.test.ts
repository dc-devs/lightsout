import { expect, test } from '@jest/globals';
import { GateOverrides } from '#src/contracts/index.ts';

// The block's refusals — an empty list, `generate`, `format`, a name written
// twice — are pinned in `GateOverrides.unit.test.ts` beside this file. What
// this file adds is the shape of the repeat refusal itself: a name written
// three times is one typo rather than two, and several repeats are reported in
// the order the author wrote them, so the message reads as the list does.

test('GateOverrides: a gate named three times is reported once, not once per extra copy', () => {
	const overrides = { 'verify-tests': ['check', 'test', 'check', 'check'] };

	const result = GateOverrides.safeParse(overrides);

	const repeats = (result.error?.issues ?? []).filter((issue) => issue.message.includes('is named more than once'));
	expect(result.success).toBe(false);
	// one issue names the typo; a second and third would say the same thing again
	expect(repeats).toHaveLength(1);
	expect(repeats[0]?.message).toMatch(/gate 'check' is named more than once/);
});

test('GateOverrides: two repeated gates are reported in the order the repeats appear', () => {
	const overrides = { 'verify-refactor': ['test', 'check', 'test', 'check'] };

	const result = GateOverrides.safeParse(overrides);

	const repeats = (result.error?.issues ?? []).map((issue) => issue.message).filter((message) => message.includes('is named more than once'));
	expect(result.success).toBe(false);
	// the author reads the report against the list they wrote, so the repeats
	// arrive in that same order rather than an order the set happened to have
	expect(repeats).toHaveLength(2);
	expect(repeats[0]).toMatch(/gate 'test' is named more than once/);
	expect(repeats[1]).toMatch(/gate 'check' is named more than once/);
});
