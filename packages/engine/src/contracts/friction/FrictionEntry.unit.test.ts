import { expect, test } from '@jest/globals';
import { FrictionEntry } from '#src/contracts/index.ts';

test('FrictionEntry: every documented area parses to its own label', () => {
	const areas = ['plan', 'prompt', 'standards', 'environment', 'other'];

	const parsed = areas.map((area) => FrictionEntry.parse({ area, detail: 'a detail' }).area);

	// these five are the taxonomy agents report against
	expect(parsed).toStrictEqual(areas);
});

test('FrictionEntry: an unrecognized area coerces to other instead of failing the entry', () => {
	const parsed = FrictionEntry.parse({ area: 'scope', detail: 'an area the agent invented' });

	// a live run once lost a valid zero-change report to an invented "scope" area
	// — the label is never load-bearing, the detail is
	expect(parsed).toStrictEqual({ area: 'other', detail: 'an area the agent invented' });
});

test('FrictionEntry: a non-string area coerces to other', () => {
	const parsed = FrictionEntry.parse({ area: 42, detail: 'a detail' });

	// best-effort means any shape of wrong label lands on other, not just an
	// unknown string
	expect(parsed.area).toBe('other');
});

test('FrictionEntry: an omitted area coerces to other', () => {
	const parsed = FrictionEntry.parse({ detail: 'a detail' });

	// detail alone is a usable entry — an agent that skips the taxonomy still gets
	// its signal recorded
	expect(parsed.area).toBe('other');
});

test('FrictionEntry: kind is optional — omitting it means friction', () => {
	const parsed = FrictionEntry.parse({ area: 'plan', detail: 'a detail' });

	// the unset kind is the documented default, not a parse failure
	expect(parsed.kind).toBe(undefined);
});

test('FrictionEntry: kind accepts both reported kinds', () => {
	const kinds = ['friction', 'decision'];

	const parsed = kinds.map((kind) => FrictionEntry.parse({ kind, area: 'plan', detail: 'a detail' }).kind);

	expect(parsed).toStrictEqual(kinds);
});

test('FrictionEntry: an unrecognized kind is rejected, unlike an unrecognized area', () => {
	const result = FrictionEntry.safeParse({ kind: 'observation', area: 'plan', detail: 'a detail' });

	// kind carries no catch — the friction/decision split is load-bearing for the
	// improvement loop
	expect(result.success).toBe(false);
	// values are lowercase
	expect(FrictionEntry.safeParse({ kind: 'Friction', area: 'plan', detail: 'a detail' }).success).toBe(false);
});

test('FrictionEntry: detail is required and must be a string', () => {
	const missing = FrictionEntry.safeParse({ area: 'plan' });

	// an entry with no detail carries no signal at all
	expect(missing.success).toBe(false);
	expect(FrictionEntry.safeParse({ area: 'plan', detail: 42 }).success).toBe(false);
});
