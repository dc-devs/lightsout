import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DedupJudgment } from '@/contracts';

const setupJudgment = (overrides: Record<string, unknown> = {}) => {
	const verdict = {
		plannedSymbol: 'formatDate',
		isDuplicate: true,
		recommendation: 'reuse',
		rationale: 'the planned symbol restates an existing utility',
		...overrides,
	};
	const otherVerdict = {
		plannedSymbol: 'parseConfig',
		isDuplicate: false,
		recommendation: 'distinct',
		rationale: 'it parses a different shape',
	};

	return { verdict, otherVerdict };
};

describe('DedupJudgment', () => {
	test('a judgment carrying several verdicts parses with each ruling intact', () => {
		const { verdict, otherVerdict } = setupJudgment();

		const parsed = DedupJudgment.parse({ verdicts: [verdict, otherVerdict] });

		assert.deepEqual(
			parsed.verdicts.map((entry) => [entry.plannedSymbol, entry.isDuplicate, entry.recommendation]),
			[
				['formatDate', true, 'reuse'],
				['parseConfig', false, 'distinct'],
			],
			'the judge rules on every candidate in one output, duplicates and non-duplicates alike',
		);
	});

	test('verdicts defaults to empty — a judgment ruling on nothing is a legitimate result', () => {
		const parsed = DedupJudgment.parse({});

		assert.deepEqual(parsed, { verdicts: [] }, 'an omitted array parses as the clean "nothing is a real duplicate" judgment rather than failing the agent contract');
	});

	test('an explicitly empty verdicts array parses', () => {
		const parsed = DedupJudgment.parse({ verdicts: [] });

		assert.deepEqual(parsed.verdicts, []);
	});

	test('each nested verdict gets its own defaults applied', () => {
		const { verdict } = setupJudgment();

		const parsed = DedupJudgment.parse({ verdicts: [verdict] });

		assert.deepEqual(parsed.verdicts[0]?.migrateCallers, [], 'the nested verdict schema still fills migrateCallers, so the join reads an array either way');
	});

	test('one malformed verdict rejects the whole judgment', () => {
		const { verdict, otherVerdict } = setupJudgment({ recommendation: 'rewrite' });

		const result = DedupJudgment.safeParse({ verdicts: [otherVerdict, verdict] });

		assert.equal(result.success, false, 'invokeAgentWithContract retries the whole output — a judgment that is only partly valid is not accepted');
	});

	test('rejects a verdicts value that is not an array', () => {
		const { verdict } = setupJudgment();

		const result = DedupJudgment.safeParse({ verdicts: verdict });

		assert.equal(result.success, false, 'a single verdict object in place of the list is a malformed judgment');
	});
});
