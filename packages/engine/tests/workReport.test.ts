import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkReport } from '@lightsout/contracts';

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
