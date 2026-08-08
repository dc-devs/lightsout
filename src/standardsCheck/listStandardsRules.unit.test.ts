import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { LightsoutConfig, StandardsRule, StandardsSeverity } from '@/contracts';
import { listStandardsRules } from '@/standardsCheck';

const baseConfig = { scripts: { check: 'true', testUnit: 'true', testCoverage: false as const } };

describe('listStandardsRules', () => {
	test('lists every rule in the closed list, sorted by id', () => {
		const rules = listStandardsRules({});

		// --list is the enforcement ledger: a rule missing from it is a rule
		// nobody can find out about
		expect(rules.map((rule) => rule.rule)).toStrictEqual([...Object.values(StandardsRule)].sort());
	});

	test('every rule names a standards doc that exists on disk', () => {
		const rules = listStandardsRules({});

		// the doc column is what makes the output actionable — a path that does not
		// resolve sends the reader to a document that cannot answer them
		const missing = rules.filter((rule) => !existsSync(join(process.cwd(), rule.doc)));

		expect(missing.map((rule) => `${rule.rule} → ${rule.doc}`)).toStrictEqual([]);
	});

	test('every rule carries a summary of its own', () => {
		const rules = listStandardsRules({});

		expect(rules.every((rule) => rule.summary.length > 0)).toBe(true);
		// no two rules describe themselves identically — that would mean one of
		// them is not really its own rule
		expect(new Set(rules.map((rule) => rule.summary)).size).toBe(rules.length);
	});

	test('a repo that says nothing sees the defaults, unmarked', () => {
		const rules = listStandardsRules({ config: LightsoutConfig.parse(baseConfig) });
		const clone = rules.find((rule) => rule.rule === StandardsRule.Clone);

		expect(clone?.severity).toBe(StandardsSeverity.Advisory);
		expect(clone?.fromConfig).toBe(false);
		// the rule's live numbers travel with it
		expect(clone?.settings).toStrictEqual({ minTokens: 50 });
	});

	test('a rule the config named is marked, so policy reads apart from default', () => {
		const rules = listStandardsRules({
			config: LightsoutConfig.parse({ ...baseConfig, standardsChecks: { 'filename-mismatch': 'off', clone: { settings: { minTokens: 90 } } } }),
		});

		const mismatch = rules.find((rule) => rule.rule === StandardsRule.FilenameMismatch);
		const clone = rules.find((rule) => rule.rule === StandardsRule.Clone);

		expect(mismatch?.severity).toBe(StandardsSeverity.Off);
		expect(mismatch?.fromConfig).toBe(true);
		// a settings-only override still counts as policy
		expect(clone?.fromConfig).toBe(true);
		expect(clone?.settings).toStrictEqual({ minTokens: 90 });
		// and every unnamed rule stays unmarked
		expect(rules.filter((rule) => rule.fromConfig).length).toBe(2);
	});
});
