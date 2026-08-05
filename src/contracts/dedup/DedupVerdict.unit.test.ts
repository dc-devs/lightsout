import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
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
			migrateCallers: ['src/plan/runPlanDraft.ts', 'src/scan/runScan.ts'],
		});

		const parsed = DedupVerdict.parse(verdict);

		assert.deepEqual(parsed, {
			plannedSymbol: 'formatDate',
			isDuplicate: true,
			recommendation: 'extract',
			rationale: 'the planned symbol restates an existing utility',
			suggestedLocation: 'src/common/utils/formatDate.ts',
			migrateCallers: ['src/plan/runPlanDraft.ts', 'src/scan/runScan.ts'],
		});
	});

	test('migrateCallers defaults to empty and suggestedLocation stays absent when the judge omits them', () => {
		const { verdict } = setupVerdict();

		const parsed = DedupVerdict.parse(verdict);

		assert.deepEqual(parsed.migrateCallers, [], 'a reuse ruling names no callers to migrate — the default keeps the join in runPlanDedup array-safe');
		assert.equal(parsed.suggestedLocation, undefined, 'suggestedLocation is meaningful only for extract, so absence is a valid ruling');
	});

	test('recommendation accepts each resolution the menu offers', () => {
		for (const recommendation of ['reuse', 'extend', 'extract', 'defer', 'distinct']) {
			const { verdict } = setupVerdict({ recommendation });

			const parsed = DedupVerdict.parse(verdict);

			assert.equal(parsed.recommendation, recommendation, `${recommendation} is one of the five resolutions the judge recommends from`);
		}
	});

	test('rejects a recommendation outside the resolution menu', () => {
		const { verdict } = setupVerdict({ recommendation: 'rewrite' });

		const result = DedupVerdict.safeParse(verdict);

		assert.equal(result.success, false, 'an invented resolution is caught at the agent boundary, before the skill offers it to a human');
	});

	test('rejects the capitalized resolution key — the contract carries the lowercase values', () => {
		const { verdict } = setupVerdict({ recommendation: 'Reuse' });

		const result = DedupVerdict.safeParse(verdict);

		assert.equal(result.success, false, 'the enum is built from the DedupResolution values, not its capitalized keys');
	});

	test('rejects a verdict missing any required field', () => {
		for (const field of ['plannedSymbol', 'isDuplicate', 'recommendation', 'rationale']) {
			const { verdict } = setupVerdict({ [field]: undefined });

			const result = DedupVerdict.safeParse(verdict);

			assert.equal(result.success, false, `${field} is required — plannedSymbol keys the join, isDuplicate decides whether a finding is written, and recommendation/rationale are what the human reads`);
		}
	});

	test('rejects a non-boolean isDuplicate rather than coercing it to truthiness', () => {
		const { verdict } = setupVerdict({ isDuplicate: 'false' });

		const result = DedupVerdict.safeParse(verdict);

		assert.equal(result.success, false, 'runPlanDedup branches on isDuplicate directly, so a truthy string must never reach it');
	});

	test('rejects a migrateCallers that is not a list of caller paths', () => {
		const { verdict } = setupVerdict({ migrateCallers: 'src/plan/runPlanDraft.ts' });

		const result = DedupVerdict.safeParse(verdict);

		assert.equal(result.success, false, 'a bare string is a malformed ruling, not a one-entry list');
	});

	test('rejects a non-string suggestedLocation', () => {
		const { verdict } = setupVerdict({ recommendation: 'extract', suggestedLocation: 42 });

		const result = DedupVerdict.safeParse(verdict);

		assert.equal(result.success, false, 'the optional field is still typed when present — it names the path the shared symbol moves to');
	});
});
