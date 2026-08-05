import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrictionEntry } from '@/contracts';

test('FrictionEntry: every documented area parses to its own label', () => {
	const areas = ['plan', 'prompt', 'standards', 'environment', 'other'];

	const parsed = areas.map((area) => FrictionEntry.parse({ area, detail: 'a detail' }).area);

	assert.deepEqual(parsed, areas, 'these five are the taxonomy agents report against');
});

test('FrictionEntry: an unrecognized area coerces to other instead of failing the entry', () => {
	const parsed = FrictionEntry.parse({ area: 'scope', detail: 'an area the agent invented' });

	assert.deepEqual(parsed, { area: 'other', detail: 'an area the agent invented' }, 'a live run once lost a valid zero-change report to an invented "scope" area — the label is never load-bearing, the detail is');
});

test('FrictionEntry: a non-string area coerces to other', () => {
	const parsed = FrictionEntry.parse({ area: 42, detail: 'a detail' });

	assert.equal(parsed.area, 'other', 'best-effort means any shape of wrong label lands on other, not just an unknown string');
});

test('FrictionEntry: an omitted area coerces to other', () => {
	const parsed = FrictionEntry.parse({ detail: 'a detail' });

	assert.equal(parsed.area, 'other', 'detail alone is a usable entry — an agent that skips the taxonomy still gets its signal recorded');
});

test('FrictionEntry: kind is optional — omitting it means friction', () => {
	const parsed = FrictionEntry.parse({ area: 'plan', detail: 'a detail' });

	assert.equal(parsed.kind, undefined, 'the unset kind is the documented default, not a parse failure');
});

test('FrictionEntry: kind accepts both reported kinds', () => {
	const kinds = ['friction', 'decision'];

	const parsed = kinds.map((kind) => FrictionEntry.parse({ kind, area: 'plan', detail: 'a detail' }).kind);

	assert.deepEqual(parsed, kinds);
});

test('FrictionEntry: an unrecognized kind is rejected, unlike an unrecognized area', () => {
	const result = FrictionEntry.safeParse({ kind: 'observation', area: 'plan', detail: 'a detail' });

	assert.equal(result.success, false, 'kind carries no catch — the friction/decision split is load-bearing for the improvement loop');
	assert.equal(FrictionEntry.safeParse({ kind: 'Friction', area: 'plan', detail: 'a detail' }).success, false, 'values are lowercase');
});

test('FrictionEntry: detail is required and must be a string', () => {
	const missing = FrictionEntry.safeParse({ area: 'plan' });

	assert.equal(missing.success, false, 'an entry with no detail carries no signal at all');
	assert.equal(FrictionEntry.safeParse({ area: 'plan', detail: 42 }).success, false);
});
