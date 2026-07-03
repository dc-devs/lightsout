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
	assert.equal(extractJsonReport({ text: 'an unbalanced { brace and {broken json}' }), undefined);
});

// The shape that failed FeedbackDrop run 91dbc0a5 twice: a valid report
// behind one sentence of preamble. Strictness belongs to the zod contract,
// not to finding the payload.
test('extractJsonReport accepts prose-wrapped JSON without fences', () => {
	assert.deepEqual(extractJsonReport({ text: 'Here is the report: {"a":1}' }), { a: 1 });
	assert.deepEqual(
		extractJsonReport({
			text: 'All files created and wired. The implementation is complete. My final report:\n\n{"status":"complete","changedFiles":[{"path":"src/a.ts","summary":"x"}]}',
		}),
		{ status: 'complete', changedFiles: [{ path: 'src/a.ts', summary: 'x' }] },
	);
});

test('extractJsonReport accepts JSON with trailing prose', () => {
	assert.deepEqual(extractJsonReport({ text: '{"a":1}\n\nLet me know if you need anything else!' }), { a: 1 });
});

test('extractJsonReport prefers the LAST embedded object (the report is the closing act)', () => {
	assert.deepEqual(extractJsonReport({ text: 'I considered {"draft":true} first.\n\nFinal: {"status":"complete"}' }), {
		status: 'complete',
	});
});

test('extractJsonReport ignores braces inside JSON strings', () => {
	assert.deepEqual(extractJsonReport({ text: 'report: {"summary":"added {config} handling for \\"x\\"","n":1}' }), {
		summary: 'added {config} handling for "x"',
		n: 1,
	});
});
