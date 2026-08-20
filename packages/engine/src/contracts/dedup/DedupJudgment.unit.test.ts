import { describe, expect, test } from '@jest/globals';
import { DedupJudgment } from '#src/contracts/index.ts';

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

		// the judge rules on every candidate in one output, duplicates and
		// non-duplicates alike
		expect(parsed.verdicts.map((entry) => [entry.plannedSymbol, entry.isDuplicate, entry.recommendation])).toStrictEqual([
			['formatDate', true, 'reuse'],
			['parseConfig', false, 'distinct'],
		]);
	});

	test('verdicts defaults to empty — a judgment ruling on nothing is a legitimate result', () => {
		const parsed = DedupJudgment.parse({});

		// an omitted array parses as the clean "nothing is a real duplicate" judgment
		// rather than failing the agent contract
		expect(parsed).toStrictEqual({ verdicts: [] });
	});

	test('an explicitly empty verdicts array parses', () => {
		const parsed = DedupJudgment.parse({ verdicts: [] });

		expect(parsed.verdicts).toStrictEqual([]);
	});

	test('each nested verdict gets its own defaults applied', () => {
		const { verdict } = setupJudgment();

		const parsed = DedupJudgment.parse({ verdicts: [verdict] });

		// the nested verdict schema still fills migrateCallers, so the join reads an
		// array either way
		expect(parsed.verdicts[0]?.migrateCallers).toStrictEqual([]);
	});

	test('one malformed verdict rejects the whole judgment', () => {
		const { verdict, otherVerdict } = setupJudgment({ recommendation: 'rewrite' });

		const result = DedupJudgment.safeParse({ verdicts: [otherVerdict, verdict] });

		// invokeAgentWithContract retries the whole output — a judgment that is only
		// partly valid is not accepted
		expect(result.success).toBe(false);
	});

	test('rejects a verdicts value that is not an array', () => {
		const { verdict } = setupJudgment();

		const result = DedupJudgment.safeParse({ verdicts: verdict });

		// a single verdict object in place of the list is a malformed judgment
		expect(result.success).toBe(false);
	});
});
