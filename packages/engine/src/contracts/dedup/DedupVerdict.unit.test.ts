import { describe, expect, test } from '@jest/globals';
import { DedupVerdict } from '@/contracts';

const setupVerdict = (overrides: Record<string, unknown> = {}) => {
	const verdict = {
		plannedSymbol: 'formatDate',
		isDuplicate: true,
		recommendation: 'reuse',
		rationale: 'the planned symbol restates an existing utility',
		...overrides,
	};

	return { verdict };
};

describe('DedupVerdict', () => {
	test('a full ruling parses with every field preserved', () => {
		const { verdict } = setupVerdict({
			recommendation: 'extract',
			suggestedLocation: 'src/common/utils/formatDate.ts',
			migrateCallers: ['src/plan/runPlanDraft.ts', 'src/standardsCheck/runStandardsCheck.ts'],
		});

		const parsed = DedupVerdict.parse(verdict);

		expect(parsed).toStrictEqual({
			plannedSymbol: 'formatDate',
			isDuplicate: true,
			recommendation: 'extract',
			rationale: 'the planned symbol restates an existing utility',
			suggestedLocation: 'src/common/utils/formatDate.ts',
			migrateCallers: ['src/plan/runPlanDraft.ts', 'src/standardsCheck/runStandardsCheck.ts'],
		});
	});

	test('migrateCallers defaults to empty and suggestedLocation stays absent when the judge omits them', () => {
		const { verdict } = setupVerdict();

		const parsed = DedupVerdict.parse(verdict);

		// a reuse ruling names no callers to migrate — the default keeps the join in
		// runPlanDedup array-safe
		expect(parsed.migrateCallers).toStrictEqual([]);
		// suggestedLocation is meaningful only for extract, so absence is a valid
		// ruling
		expect(parsed.suggestedLocation).toBe(undefined);
	});

	test('recommendation accepts each resolution the menu offers', () => {
		for (const recommendation of ['reuse', 'extend', 'extract', 'defer', 'distinct']) {
			const { verdict } = setupVerdict({ recommendation });

			const parsed = DedupVerdict.parse(verdict);

			// ${recommendation} is one of the five resolutions the judge recommends from
			expect(parsed.recommendation).toBe(recommendation);
		}
	});

	test('rejects a recommendation outside the resolution menu', () => {
		const { verdict } = setupVerdict({ recommendation: 'rewrite' });

		const result = DedupVerdict.safeParse(verdict);

		// an invented resolution is caught at the agent boundary, before the skill
		// offers it to a human
		expect(result.success).toBe(false);
	});

	test('rejects the capitalized resolution key — the contract carries the lowercase values', () => {
		const { verdict } = setupVerdict({ recommendation: 'Reuse' });

		const result = DedupVerdict.safeParse(verdict);

		// the enum is built from the DedupResolution values, not its capitalized keys
		expect(result.success).toBe(false);
	});

	test('rejects a verdict missing any required field', () => {
		for (const field of ['plannedSymbol', 'isDuplicate', 'recommendation', 'rationale']) {
			const { verdict } = setupVerdict({ [field]: undefined });

			const result = DedupVerdict.safeParse(verdict);

			// ${field} is required — plannedSymbol keys the join, isDuplicate decides
			// whether a finding is written, and recommendation/rationale are what the
			// human reads
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-boolean isDuplicate rather than coercing it to truthiness', () => {
		const { verdict } = setupVerdict({ isDuplicate: 'false' });

		const result = DedupVerdict.safeParse(verdict);

		// runPlanDedup branches on isDuplicate directly, so a truthy string must never
		// reach it
		expect(result.success).toBe(false);
	});

	test('rejects a migrateCallers that is not a list of caller paths', () => {
		const { verdict } = setupVerdict({ migrateCallers: 'src/plan/runPlanDraft.ts' });

		const result = DedupVerdict.safeParse(verdict);

		// a bare string is a malformed ruling, not a one-entry list
		expect(result.success).toBe(false);
	});

	test('rejects a non-string suggestedLocation', () => {
		const { verdict } = setupVerdict({ recommendation: 'extract', suggestedLocation: 42 });

		const result = DedupVerdict.safeParse(verdict);

		// the optional field is still typed when present — it names the path the
		// shared symbol moves to
		expect(result.success).toBe(false);
	});
});
