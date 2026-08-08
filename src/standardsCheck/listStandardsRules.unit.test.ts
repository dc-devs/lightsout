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

	test('each path rule names the doc that actually states it', () => {
		const rules = listStandardsRules({});
		const docs = Object.fromEntries(rules.filter((rule) => rule.rule.startsWith('path-')).map((rule) => [rule.rule, rule.doc]));

		// the check above proves a doc path resolves, not that it is the right one:
		// the no-barrels-under-common rule comes from module-api.md, the four
		// test-location rules from unit-testing.md, and the rest from
		// folder-structure.md
		expect(docs).toStrictEqual({
			'path-banned-module-name': 'standards/code/architecture/folder-structure.md',
			'path-common-flat': 'standards/code/architecture/folder-structure.md',
			'path-common-barrel': 'standards/code/style-guide/structure/module-api.md',
			'path-test-in-tests-folder': 'standards/tests/unit/jest/unit-testing.md',
			'path-test-not-colocated': 'standards/tests/unit/jest/unit-testing.md',
			'path-test-support-in-src': 'standards/tests/unit/jest/unit-testing.md',
			'path-test-untested-subject-not-public': 'standards/tests/unit/jest/unit-testing.md',
			'path-folder-casing': 'standards/code/architecture/folder-structure.md',
			'path-domain-folder-single-file': 'standards/code/architecture/folder-structure.md',
		});
	});

	test('the path rules ship at the severity each was designed for', () => {
		const rules = listStandardsRules({});
		const severities = Object.fromEntries(rules.filter((rule) => rule.rule.startsWith('path-')).map((rule) => [rule.rule, rule.severity]));

		// six blocking and three advisory, from day one. The blocking six are each a
		// file move or a rename against a closed list from a doc; the advisory three
		// rest on judgment the rule can only approximate, or offer the repo more
		// than one legitimate remedy
		expect(severities).toStrictEqual({
			'path-banned-module-name': StandardsSeverity.Blocking,
			'path-common-flat': StandardsSeverity.Blocking,
			'path-common-barrel': StandardsSeverity.Blocking,
			'path-test-in-tests-folder': StandardsSeverity.Blocking,
			'path-test-not-colocated': StandardsSeverity.Blocking,
			'path-test-support-in-src': StandardsSeverity.Blocking,
			'path-test-untested-subject-not-public': StandardsSeverity.Advisory,
			'path-folder-casing': StandardsSeverity.Advisory,
			'path-domain-folder-single-file': StandardsSeverity.Advisory,
		});
	});

	test('no path rule carries a number a repo could tune', () => {
		const rules = listStandardsRules({});
		const tunable = rules.filter((rule) => rule.rule.startsWith('path-') && Object.keys(rule.settings).length > 0);

		// every threshold in this group is a closed list of names from a doc, never a
		// count — a knob here would be a rule that can be quietly widened until it
		// stops firing
		expect(tunable.map((rule) => rule.rule)).toStrictEqual([]);
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
