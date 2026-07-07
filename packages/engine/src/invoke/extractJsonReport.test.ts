import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkReport } from '@lightsout/contracts';
import { extractJsonReport } from './extractJsonReport';

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

// The shape that failed FeedbackDrop run d91f2f74 at attempt 2: the re-emit
// retry reproduced the rejected report, caught its own invalid friction area
// mid-message, and emitted a corrected second fenced block — which the old
// first-fence match threw away.
test('extractJsonReport prefers the LAST parseable fenced block (a re-emitter self-corrects mid-message)', () => {
	const text = [
		'```json',
		'{"status":"complete","changedFiles":[],"summary":"No changes warranted.","friction":[{"kind":"decision","area":"scope","detail":"duplication across scope boundary"}]}',
		'```',
		'',
		'Wait — the first friction entry uses `area: "scope"`, which is invalid. Best mapped to `other`.',
		'',
		'```json',
		'{"status":"complete","changedFiles":[],"summary":"No changes warranted.","friction":[{"kind":"decision","area":"other","detail":"duplication across scope boundary"}]}',
		'```',
	].join('\n');
	const extracted = extractJsonReport({ text }) as { friction: Array<{ area: string }> };

	assert.equal(extracted.friction[0]?.area, 'other');
});

test('extractJsonReport falls back to an earlier fenced block when the last is unparseable', () => {
	assert.deepEqual(extractJsonReport({ text: '```json\n{"a":1}\n```\nnotes:\n```\nnot json at all\n```' }), { a: 1 });
});

// The shape that failed the same run at attempt 1: a valid zero-change
// report rejected over one invented friction label. Taxonomy is telemetry —
// it degrades to `other`, it never sinks the report.
test('WorkReport coerces an unrecognized friction area to other instead of rejecting', () => {
	const report = WorkReport.parse({
		status: 'complete',
		changedFiles: [],
		summary: 'No changes warranted.',
		friction: [{ kind: 'decision', area: 'scope', detail: 'duplication across scope boundary' }],
	});

	assert.equal(report.friction?.[0]?.area, 'other');
	assert.equal(report.friction?.[0]?.detail, 'duplication across scope boundary');
});

test('extractJsonReport ignores braces inside JSON strings', () => {
	assert.deepEqual(extractJsonReport({ text: 'report: {"summary":"added {config} handling for \\"x\\"","n":1}' }), {
		summary: 'added {config} handling for "x"',
		n: 1,
	});
});
