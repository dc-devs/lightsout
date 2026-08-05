import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrictionRecord } from '@/contracts';

const entry = { kind: 'friction', area: 'environment', detail: 'no jest config in the package' };
const provenance = { at: '2026-01-01T00:00:00.000Z', runId: 'run-1234-abcd', step: 'write-tests' };

test('FrictionRecord: a persisted line carries the reported entry plus its provenance', () => {
	const parsed = FrictionRecord.parse({ ...entry, ...provenance });

	assert.deepEqual(parsed, {
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

	assert.equal(parsed.kind, undefined, 'a record written from a kind-less entry is still a valid line');
});

test('FrictionRecord: the area coercion is inherited — a stale label reads back as other', () => {
	const parsed = FrictionRecord.parse({ ...provenance, area: 'scope', detail: 'written by an older agent' });

	assert.equal(parsed.area, 'other', 'a label an older run invented must not drop the whole line on read-back');
});

test('FrictionRecord: a record missing any provenance field is rejected', () => {
	const withoutAt = FrictionRecord.safeParse({ ...entry, runId: 'run-1234-abcd', step: 'write-tests' });

	assert.equal(withoutAt.success, false, 'at is the timestamp the ledger is ordered by');
	assert.equal(FrictionRecord.safeParse({ ...entry, at: '2026-01-01T00:00:00.000Z', step: 'write-tests' }).success, false, 'runId ties the entry to the run that produced it');
	assert.equal(FrictionRecord.safeParse({ ...entry, at: '2026-01-01T00:00:00.000Z', runId: 'run-1234-abcd' }).success, false, 'step names where in the pipeline the friction happened');
});

test('FrictionRecord: provenance fields must be strings', () => {
	const result = FrictionRecord.safeParse({ ...entry, ...provenance, at: 1767225600000 });

	assert.equal(result.success, false, 'at is the ISO string the JSONL line records, not an epoch number');
});

test('FrictionRecord: unknown keys are stripped rather than carried into the ledger', () => {
	const parsed = FrictionRecord.parse({ ...entry, ...provenance, severity: 'high' });

	assert.deepEqual(Object.keys(parsed).sort(), ['area', 'at', 'detail', 'kind', 'runId', 'step'], 'the record shape is fixed — a field an agent invents never reaches the persisted line');
});
