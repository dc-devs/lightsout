import { expect, test } from '@jest/globals';
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

	// matches defaults to empty — "searched, found nothing" is a valid entry
	expect(parsed.priorArt?.[0]).toStrictEqual({ symbol: 'formatDate', searches: ['formatDate', 'dateToString'], matches: [] });
	expect(parsed.priorArt?.[1]?.matches).toStrictEqual(['loadConfig']);

	// field is optional — non-executor roles omit it
	expect(WorkReport.parse(base).priorArt).toBe(undefined);
	// an entry without searches is rejected
	expect(WorkReport.safeParse({ ...base, priorArt: [{ symbol: 'x' }] }).success).toBe(false);
});

test('WorkReport status: every terminal outcome parses and nothing outside the set does', () => {
	const statuses = ['complete', 'failed', 'terminated:ambiguity', 'terminated:stale-references', 'terminated:scope'];

	const accepted = statuses.filter((status) => WorkReport.safeParse({ ...base, status }).success);

	// these five are the whole vocabulary the engine branches on
	expect(accepted).toStrictEqual(statuses);
	// a bare "terminated" names no reason — the engine could not route it
	expect(WorkReport.safeParse({ ...base, status: 'terminated' }).success).toBe(false);
	// values are lowercase
	expect(WorkReport.safeParse({ ...base, status: 'Complete' }).success).toBe(false);
	// status is required — there is no default outcome
	expect(WorkReport.safeParse({ changedFiles: [], summary: 'x', failures: [] }).success).toBe(false);
});

test('WorkReport failures: omitting the array on a clean report means none', () => {
	const parsed = WorkReport.parse({ status: 'complete', changedFiles: [], summary: 'x' });

	// a complete report that omits failures parses rather than paying for a
	// re-emit retry
	expect(parsed.failures).toStrictEqual([]);
});

test('WorkReport friction: entries parse and an unrecognized area coerces instead of failing the report', () => {
	const parsed = WorkReport.parse({
		...base,
		friction: [
			{ kind: 'decision', area: 'plan', detail: 'the plan named no fixture' },
			{ area: 'scope', detail: 'an area the agent invented' },
		],
	});

	// an invented area degrades to other — a valid zero-change report must never
	// die over its friction taxonomy
	expect(parsed.friction).toStrictEqual([
		{ kind: 'decision', area: 'plan', detail: 'the plan named no fixture' },
		{ area: 'other', detail: 'an area the agent invented' },
	]);
});

test('WorkReport friction: the array is optional — a clean run omits it', () => {
	const parsed = WorkReport.parse(base);

	// no friction reported is the absence of the key, not an empty array
	expect(parsed.friction).toBe(undefined);
});

test('WorkReport: the narrative fields are required and each changed file names a path and a summary', () => {
	const noChangedFiles = WorkReport.safeParse({ status: 'complete', summary: 'x', failures: [] });

	// changedFiles is required — an empty array is how a no-op run says "nothing
	// changed"
	expect(noChangedFiles.success).toBe(false);
	// summary is required — the report always says what was done
	expect(WorkReport.safeParse({ status: 'complete', changedFiles: [], failures: [] }).success).toBe(false);
	// a changed file without its one-clause summary is rejected
	expect(WorkReport.safeParse({ ...base, changedFiles: [{ path: 'src/a.ts' }] }).success).toBe(false);
	// failures are strings
	expect(WorkReport.safeParse({ ...base, failures: ['a failure', 7] }).success).toBe(false);
});

test('WorkReport advisoryOutcomes: entries parse; a missing or partial account is data, not a failure', () => {
	const parsed = WorkReport.parse({
		...base,
		advisoryOutcomes: [
			{ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'applied' },
			{ rule: 'dead-export', siteKey: 'dead-export:src/b.ts', outcome: 'declined', reason: 'deleting an export is a public-API change' },
		],
	});

	// the whole entry survives — runBatch keys these by siteKey and the health
	// report prints the rule and the decline reason verbatim
	expect(parsed.advisoryOutcomes).toStrictEqual([
		{ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'applied' },
		{ rule: 'dead-export', siteKey: 'dead-export:src/b.ts', outcome: 'declined', reason: 'deleting an export is a public-API change' },
	]);
	// an agent that was shown no advice, or asked for none, omits the key
	expect(WorkReport.parse(base).advisoryOutcomes).toBe(undefined);
	// an agent shown advice that answered for none of it reports an empty list
	expect(WorkReport.parse({ ...base, advisoryOutcomes: [] }).advisoryOutcomes).toStrictEqual([]);
	// but an entry that means nothing is refused rather than counted as something
	expect(WorkReport.safeParse({ ...base, advisoryOutcomes: [{ rule: 'size-function', siteKey: 'x', outcome: 'partly' }] }).success).toBe(false);
	// and a lone entry outside the list is a malformed report, not a one-entry account
	expect(WorkReport.safeParse({ ...base, advisoryOutcomes: { rule: 'size-function', siteKey: 'x', outcome: 'applied' } }).success).toBe(false);
});
