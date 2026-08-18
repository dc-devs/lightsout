import { expect, test } from '@jest/globals';
import { StandardsCheckOverrides } from '@/contracts';

test('StandardsCheckOverrides: the renamed finding severity is refused with a message naming blocking', () => {
	const bare = StandardsCheckOverrides.safeParse({ clone: 'finding' });

	// a value copied from the pre-rename docs is told what happened, rather than
	// being handed a bare list of the three valid options
	expect(bare.success).toBe(false);
	expect(bare.error?.message ?? '').toMatch(/severity `finding` was renamed to `blocking`/);

	// the object form takes the same value in a different position — both reject
	const nested = StandardsCheckOverrides.safeParse({ clone: { severity: 'finding' } });

	expect(nested.success).toBe(false);
	expect(nested.error?.message ?? '').toMatch(/severity `finding` was renamed to `blocking`/);

	// an ordinary typo keeps the ordinary enum error — only the retired spelling is called out
	expect(StandardsCheckOverrides.safeParse({ clone: 'blockign' }).error?.message ?? '').not.toMatch(/was renamed/);
});

test('StandardsCheckOverrides: both override forms come through parsing intact', () => {
	const overrides = {
		clone: 'off',
		'size-file': { severity: 'advisory', settings: { file: 200, tsxFile: 260 } },
	};

	// a bare severity and a full object are both recognized, so neither is
	// stripped as an unknown shape
	expect(StandardsCheckOverrides.parse(overrides)).toStrictEqual(overrides);
});

test('StandardsCheckOverrides: a rule the map never names is left alone entirely', () => {
	// naming one rule says nothing about the other sixteen — silence is never a change
	expect(StandardsCheckOverrides.parse({ 'size-function': { settings: { function: 40 } } })).toStrictEqual({ 'size-function': { settings: { function: 40 } } });
	// an empty map is valid — every rule already has a default
	expect(StandardsCheckOverrides.parse({})).toStrictEqual({});
});

test.each([{ severity: 'blocking' }, { severity: 'advisory' }, { severity: 'off' }])(
	'StandardsCheckOverrides: $severity parses as a bare value and inside an override object',
	({ severity }) => {
		// all three states are settable, including off — the only way a repo stops a
		// rule blocking is by naming it here
		expect(StandardsCheckOverrides.parse({ clone: severity })).toStrictEqual({ clone: severity });
		// the object form reaches the same state, so a repo adding settings later
		// never has to restate the severity in a different vocabulary
		expect(StandardsCheckOverrides.parse({ clone: { severity } })).toStrictEqual({ clone: { severity } });
	},
);

test('StandardsCheckOverrides: an override object may carry severity alone, settings alone, or neither', () => {
	const overrides = {
		clone: { severity: 'advisory' },
		'folder-census': { settings: { cap: 30 } },
		'barrel-star': {},
	};

	// both fields are independently optional: severity without settings keeps the
	// rule's default knobs, settings without severity keeps its default severity,
	// and an empty object changes nothing at all
	expect(StandardsCheckOverrides.parse(overrides)).toStrictEqual(overrides);
});

test('StandardsCheckOverrides: a settings value is checked as a number and nothing more', () => {
	// settings keys belong to the rule, not this schema, so a zero or a fraction
	// parses here — whether a value makes sense is the rule's own business
	expect(StandardsCheckOverrides.parse({ clone: { settings: { minTokens: 0, ratio: 1.5 } } })).toStrictEqual({
		clone: { settings: { minTokens: 0, ratio: 1.5 } },
	});
});

test('StandardsCheckOverrides: a rule id this schema has never heard of parses, because the packages own the vocabulary', () => {
	// a third-party standards package brings its own rule ids, so a closed list
	// here would refuse every package but the bundled one. The typo `size-fil`
	// is still caught — by `resolvePackageRuleStates`, where the loaded packages
	// make the valid ids knowable, and it names them in the refusal
	expect(StandardsCheckOverrides.parse({ 'house-style-no-default-export': 'off', 'size-fil': 'off' })).toStrictEqual({
		'house-style-no-default-export': 'off',
		'size-fil': 'off',
	});
});

test.each([
	{ label: 'a severity outside the three states', overrides: { clone: 'warn' } },
	{ label: 'a severity outside the three states inside an object', overrides: { clone: { severity: 'warn' } } },
	{ label: 'a settings key that is not a number', overrides: { clone: { settings: { minTokens: '50' } } } },
	{ label: 'an override object carrying a key the shape does not declare', overrides: { clone: { severty: 'off' } } },
	{ label: 'an overrides map that is not an object', overrides: true },
])('StandardsCheckOverrides: $label fails parsing', ({ overrides }) => {
	// a mistyped severity would silently disable an override the user believes is
	// active — the same reason the commands block is strict
	expect(StandardsCheckOverrides.safeParse(overrides).success).toBe(false);
});
