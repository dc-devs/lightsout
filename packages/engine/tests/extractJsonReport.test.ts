import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJsonReport } from '../src/extractJsonReport';

test('extractJsonReport accepts bare JSON', () => {
	assert.deepEqual(extractJsonReport({ text: ' {"status":"complete"} ' }), { status: 'complete' });
});

test('extractJsonReport accepts ```json fenced JSON', () => {
	assert.deepEqual(extractJsonReport({ text: '```json\n{"a":1}\n```' }), { a: 1 });
});

test('extractJsonReport accepts bare-fenced JSON', () => {
	assert.deepEqual(extractJsonReport({ text: '```\n{"a":1}\n```' }), { a: 1 });
});

test('extractJsonReport rejects garbage', () => {
	assert.equal(extractJsonReport({ text: 'I could not produce a report, sorry.' }), undefined);
});

test('extractJsonReport rejects prose-wrapped JSON without fences', () => {
	assert.equal(extractJsonReport({ text: 'Here is the report: {"a":1}' }), undefined);
});
