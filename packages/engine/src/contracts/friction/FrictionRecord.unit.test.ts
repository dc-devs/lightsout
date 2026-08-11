import { expect, test } from '@jest/globals';
import { FrictionRecord } from '@/contracts';

const entry = { kind: 'friction', area: 'environment', detail: 'no jest config in the package' };
const provenance = { at: '2026-01-01T00:00:00.000Z', runId: 'run-1234-abcd', step: 'write-tests' };

test('FrictionRecord: a persisted line carries the reported entry plus its provenance', () => {
	const parsed = FrictionRecord.parse({ ...entry, ...provenance });

	expect(parsed).toStrictEqual({
		kind: 'friction',
		area: 'environment',
		detail: 'no jest config in the package',
		at: '2026-01-01T00:00:00.000Z',
		runId: 'run-1234-abcd',
		step: 'write-tests',
	});
});

test('FrictionRecord: the entry fields stay optional through the extension', () => {
	const parsed = FrictionRecord.parse({ ...provenance, area: 'plan', detail: 'a detail' });

	// a record written from a kind-less entry is still a valid line
	expect(parsed.kind).toBe(undefined);
});

test('FrictionRecord: the area coercion is inherited — a stale label reads back as other', () => {
	const parsed = FrictionRecord.parse({ ...provenance, area: 'scope', detail: 'written by an older agent' });

	// a label an older run invented must not drop the whole line on read-back
	expect(parsed.area).toBe('other');
});

test('FrictionRecord: a record missing any provenance field is rejected', () => {
	const withoutAt = FrictionRecord.safeParse({ ...entry, runId: 'run-1234-abcd', step: 'write-tests' });

	// at is the timestamp the ledger is ordered by
	expect(withoutAt.success).toBe(false);
	// runId ties the entry to the run that produced it
	expect(FrictionRecord.safeParse({ ...entry, at: '2026-01-01T00:00:00.000Z', step: 'write-tests' }).success).toBe(false);
	// step names where in the pipeline the friction happened
	expect(FrictionRecord.safeParse({ ...entry, at: '2026-01-01T00:00:00.000Z', runId: 'run-1234-abcd' }).success).toBe(false);
});

test('FrictionRecord: provenance fields must be strings', () => {
	const result = FrictionRecord.safeParse({ ...entry, ...provenance, at: 1767225600000 });

	// at is the ISO string the JSONL line records, not an epoch number
	expect(result.success).toBe(false);
});

test('FrictionRecord: unknown keys are stripped rather than carried into the ledger', () => {
	const parsed = FrictionRecord.parse({ ...entry, ...provenance, severity: 'high' });

	// the record shape is fixed — a field an agent invents never reaches the
	// persisted line
	expect(Object.keys(parsed).sort()).toStrictEqual(['area', 'at', 'detail', 'kind', 'runId', 'step']);
});
