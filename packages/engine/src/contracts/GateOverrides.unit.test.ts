import { expect, test } from '@jest/globals';
import { GateOverrides } from '#src/contracts/index.ts';

test('GateOverrides: an empty list is refused with a message naming "off"', () => {
	const result = GateOverrides.safeParse({ 'verify-tests': [] });

	// an empty list and "off" would be two spellings of one meaning, so the empty
	// one fails and the message tells the author the spelling that works
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/must name at least one gate/);
	expect(result.error?.message ?? '').toMatch(/"off"/);
});

test('GateOverrides: generate and format are refused as checkpoint gates', () => {
	const generate = GateOverrides.safeParse({ 'verify-implement': ['check', 'generate'] });

	// `generate` writes the files gates read, so it already runs before the list —
	// naming it would say it was scheduled as a gate
	expect(generate.success).toBe(false);
	expect(generate.error?.message ?? '').toMatch(/'generate' is not a checkpoint gate/);
	expect(generate.error?.message ?? '').toMatch(/gates\.generate runs before/);

	const format = GateOverrides.safeParse({ 'verify-implement': ['check', 'format'] });

	// `format` runs once at the very end of the pipeline, so naming it here would
	// have the author believe formatting was scheduled when nothing would run it
	expect(format.success).toBe(false);
	expect(format.error?.message ?? '').toMatch(/'format' is not a checkpoint gate/);
	expect(format.error?.message ?? '').toMatch(/runs once at the very end of the pipeline/);
});

test('GateOverrides: a gate named twice in one list is refused, naming the repeat', () => {
	const result = GateOverrides.safeParse({ 'verify-refactor': ['check', 'test', 'check'] });

	// a gate running twice in a row proves nothing the first run did not, so a
	// repeat is a typo — and collapsing it quietly would be a silent rewrite
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/gate 'check' is named more than once/);
});

test('GateOverrides: a valid block round-trips, "off" included', () => {
	const overrides = {
		'clean-slate': 'off',
		'verify-implement': ['check', 'test'],
		'verify-tests': ['test-coverage'],
		'verify-refactor': ['check', 'build', 'test-e2e'],
	};

	// validation only — the block is read back exactly as written, list order
	// included, because the declared order is the whole reason to write one
	expect(GateOverrides.parse(overrides)).toStrictEqual(overrides);
	// every checkpoint is optional: an unlisted one keeps the engine's default
	expect(GateOverrides.parse({})).toStrictEqual({});
});

test('GateOverrides: an unknown checkpoint key is refused rather than stripped', () => {
	const result = GateOverrides.safeParse({ 'verify-implememt': ['check'] });

	// a misspelled checkpoint stripped in silence would leave the author believing
	// a schedule is set that nothing ever reads
	expect(result.success).toBe(false);
});
