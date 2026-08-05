import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkReport } from '@/contracts';

const base = { status: 'complete', changedFiles: [], summary: 'x', failures: [] };

test('WorkReport priorArt: valid entries parse with matches defaulted; malformed entries reject', () => {
	const parsed = WorkReport.parse({
		...base,
		priorArt: [
			{ symbol: 'formatDate', searches: ['formatDate', 'dateToString'] },
			{ symbol: 'parseConfig', searches: ['parseConfig'], matches: ['loadConfig'] },
		],
	});

	assert.deepEqual(parsed.priorArt?.[0], { symbol: 'formatDate', searches: ['formatDate', 'dateToString'], matches: [] }, 'matches defaults to empty — "searched, found nothing" is a valid entry');
	assert.deepEqual(parsed.priorArt?.[1]?.matches, ['loadConfig']);

	assert.equal(WorkReport.parse(base).priorArt, undefined, 'field is optional — non-executor roles omit it');
	assert.equal(WorkReport.safeParse({ ...base, priorArt: [{ symbol: 'x' }] }).success, false, 'an entry without searches is rejected');
});

test('WorkReport status: every terminal outcome parses and nothing outside the set does', () => {
	const statuses = ['complete', 'failed', 'terminated:ambiguity', 'terminated:stale-references', 'terminated:scope'];

	const accepted = statuses.filter((status) => WorkReport.safeParse({ ...base, status }).success);

	assert.deepEqual(accepted, statuses, 'these five are the whole vocabulary the engine branches on');
	assert.equal(WorkReport.safeParse({ ...base, status: 'terminated' }).success, false, 'a bare "terminated" names no reason — the engine could not route it');
	assert.equal(WorkReport.safeParse({ ...base, status: 'Complete' }).success, false, 'values are lowercase');
	assert.equal(WorkReport.safeParse({ changedFiles: [], summary: 'x', failures: [] }).success, false, 'status is required — there is no default outcome');
});

test('WorkReport failures: omitting the array on a clean report means none', () => {
	const parsed = WorkReport.parse({ status: 'complete', changedFiles: [], summary: 'x' });

	assert.deepEqual(parsed.failures, [], 'a complete report that omits failures parses rather than paying for a re-emit retry');
});

test('WorkReport friction: entries parse and an unrecognized area coerces instead of failing the report', () => {
	const parsed = WorkReport.parse({
		...base,
		friction: [
			{ kind: 'decision', area: 'plan', detail: 'the plan named no fixture' },
			{ area: 'scope', detail: 'an area the agent invented' },
		],
	});

	assert.deepEqual(
		parsed.friction,
		[
			{ kind: 'decision', area: 'plan', detail: 'the plan named no fixture' },
			{ area: 'other', detail: 'an area the agent invented' },
		],
		'an invented area degrades to other — a valid zero-change report must never die over its friction taxonomy',
	);
});

test('WorkReport friction: the array is optional — a clean run omits it', () => {
	const parsed = WorkReport.parse(base);

	assert.equal(parsed.friction, undefined, 'no friction reported is the absence of the key, not an empty array');
});

test('WorkReport: the narrative fields are required and each changed file names a path and a summary', () => {
	const noChangedFiles = WorkReport.safeParse({ status: 'complete', summary: 'x', failures: [] });

	assert.equal(noChangedFiles.success, false, 'changedFiles is required — an empty array is how a no-op run says "nothing changed"');
	assert.equal(WorkReport.safeParse({ status: 'complete', changedFiles: [], failures: [] }).success, false, 'summary is required — the report always says what was done');
	assert.equal(WorkReport.safeParse({ ...base, changedFiles: [{ path: 'src/a.ts' }] }).success, false, 'a changed file without its one-clause summary is rejected');
	assert.equal(WorkReport.safeParse({ ...base, failures: ['a failure', 7] }).success, false, 'failures are strings');
});
