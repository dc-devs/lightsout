import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import { LightsoutConfig, StandardsSeverity } from '@/contracts';
import { listStandardsRules } from '@/standardsCheck';

const baseConfig = { scripts: { check: 'true', testUnit: 'true', testCoverage: false as const } };

/** The repo the listing is read for — the shipped package answers regardless, since it travels with the engine. */
const cwd = process.cwd();

/**
 * The rule ids that predate the package format. A repo's baseline keys, its
 * config overrides and its frozen refactor work-lists are all written in these
 * strings, so one of them going missing is a silent break in persisted data —
 * which is why they are restated here rather than read back off the package.
 */
const durableRuleIds = [
	'ast-duplicate',
	'barrel-dead-entry',
	'barrel-only-export',
	'barrel-star',
	'clone',
	'dead-export',
	'domain-graduation',
	'filename-mismatch',
	'folder-census',
	'module-boundary',
	'multi-export',
	'name-duplicate',
	'name-synonym',
	'path-banned-module-name',
	'path-common-barrel',
	'path-common-flat',
	'path-domain-folder-single-file',
	'path-folder-casing',
	'path-test-in-tests-folder',
	'path-test-not-colocated',
	'path-test-support-in-src',
	'path-test-untested-subject-not-public',
	'placement',
	'size-file',
	'size-function',
	'test-assert-in-hook',
	'test-manual-mock-cleanup',
	'test-mega-factory',
	'test-mock-prefix',
	'test-mock-return-in-hook',
	'test-mock-untyped',
	'test-mock-wrapper-untyped',
	'test-multiple-setups',
	'test-nested-describe',
	'test-only-export',
	'test-shared-let',
	'test-strict-equal-matcher',
];

/** The file-placement rules code checks — `path-aliases` shares the prefix but is prose an agent has to judge. */
const durablePathRules = durableRuleIds.filter((id) => id.startsWith('path-'));

/** 'lightsout-defaults: code/…' split back into the package name and the document folder the row names. */
const docPartsOf = ({ doc }: { doc: string }) => {
	const [name, path] = doc.split(': ');

	return { name: name ?? '', path: path ?? '' };
};

/** A temp consumer repo — the listing reads exactly the packages its config declares. */
const setupRepo = () => ({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-list-rules-')) });

/**
 * A judgment-only standards package written under `at`, holding one rule that
 * declares whatever the caller passes. Nothing here is shipped by the engine,
 * so a row read back off it proves the listing carries the package author's own
 * words rather than the defaults.
 */
const setupPackage = ({
	cwd,
	at,
	name,
	ruleId,
	severity = StandardsSeverity.Advisory,
	settings = {},
}: {
	cwd: string;
	at: string;
	name: string;
	ruleId: string;
	severity?: typeof StandardsSeverity.Blocking | typeof StandardsSeverity.Advisory;
	settings?: Record<string, number>;
}) => {
	const packagePath = join(cwd, at);
	const rulePath = `code/demo/01-${ruleId}`;
	const settingLines = Object.entries(settings).map(([key, value]) => `  ${key}: ${value}`);
	const settingsBlock = settingLines.length === 0 ? '' : `settings:\n${settingLines.join('\n')}\n`;
	const files: Record<string, string> = {
		'lightsout-standards.json': `{ "name": "${name}", "formatVersion": 1 }\n`,
		'code/demo/document.md': '# Demo\n\nThe document the rule argues under.\n',
		[`${rulePath}/rule.md`]: `---\nsummary: what ${ruleId} catches\nseverity: ${severity}\n${settingsBlock}---\n\nThe rule prose.\n`,
		[`${rulePath}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
		[`${rulePath}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
	};

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packagePath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { packagePath };
};

describe('listStandardsRules', () => {
	test('lists every rule the loaded packages declare, sorted by id', async () => {
		const rules = await listStandardsRules({ cwd });

		// --list is the enforcement ledger: a rule missing from it is a rule
		// nobody can find out about
		expect(rules.length > durableRuleIds.length).toBe(true);
		expect(rules.map((rule) => rule.rule)).toStrictEqual([...rules.map((rule) => rule.rule)].sort());
		expect(new Set(rules.map((rule) => rule.rule)).size).toBe(rules.length);
	});

	test('every rule id a repo may already have written down is still declared', async () => {
		const rules = await listStandardsRules({ cwd });
		const ids = new Set(rules.map((rule) => rule.rule));

		// a baseline entry, a config override or a parked work-list names these
		// strings — renaming one silently unbaselines whatever it suppressed
		expect(durableRuleIds.filter((id) => !ids.has(id))).toStrictEqual([]);
	});

	test('judgment-only rules are listed beside the machine-checked ones, each marked for which it is', async () => {
		const rules = await listStandardsRules({ cwd });

		// the ledger has to admit which of its rules no code run will ever catch,
		// or it reads as though every listed rule were enforced
		expect(rules.some((rule) => rule.checked)).toBe(true);
		expect(rules.some((rule) => !rule.checked)).toBe(true);
		// and every one of the durable ids is a rule code checks — they are the
		// rules that had a check before the package format existed
		expect(rules.filter((rule) => durableRuleIds.includes(rule.rule) && !rule.checked).map((rule) => rule.rule)).toStrictEqual([]);
	});

	test('every rule names the package that states it and a document folder inside that package', async () => {
		const rules = await listStandardsRules({ cwd });

		// the doc column is what makes the output actionable — a row naming a
		// document that is not there sends the reader nowhere
		const missing = rules.filter((rule) => {
			const { name, path } = docPartsOf({ doc: rule.doc });

			return name !== 'lightsout-defaults' || !existsSync(join(cwd, 'standards', path, 'document.md'));
		});

		expect(missing.map((rule) => `${rule.rule} → ${rule.doc}`)).toStrictEqual([]);
	});

	test('every rule carries a summary of its own', async () => {
		const rules = await listStandardsRules({ cwd });

		expect(rules.every((rule) => rule.summary.length > 0)).toBe(true);
		// no two rules describe themselves identically — that would mean one of
		// them is not really its own rule
		expect(new Set(rules.map((rule) => rule.summary)).size).toBe(rules.length);
	});

	test('the rules drawn from the tests tree are the test-writing rules, and no code rule is among them', async () => {
		const rules = await listStandardsRules({ cwd });
		const fromTests = rules.filter((rule) => docPartsOf({ doc: rule.doc }).path.startsWith('tests/'));
		const checkedFromTests = fromTests.filter((rule) => durableRuleIds.includes(rule.rule)).map((rule) => rule.rule);

		// which half of the ledger holds a rule is read off the document it comes
		// from — which is why `test-only-export` and the four test-location rules
		// sit here, away from the passes they used to share
		expect(checkedFromTests.sort()).toStrictEqual([
			'path-test-in-tests-folder',
			'path-test-not-colocated',
			'path-test-support-in-src',
			'path-test-untested-subject-not-public',
			'test-assert-in-hook',
			'test-manual-mock-cleanup',
			'test-mega-factory',
			'test-mock-prefix',
			'test-mock-return-in-hook',
			'test-mock-untyped',
			'test-mock-wrapper-untyped',
			'test-multiple-setups',
			'test-nested-describe',
			'test-only-export',
			'test-shared-let',
			'test-strict-equal-matcher',
		]);
	});

	test('each path rule names the document that actually states it', async () => {
		const rules = await listStandardsRules({ cwd });
		const docs = Object.fromEntries(
			rules.filter((rule) => durablePathRules.includes(rule.rule)).map((rule) => [rule.rule, docPartsOf({ doc: rule.doc }).path]),
		);

		// the check above proves a document is there, not that it is the right one:
		// the no-barrels-under-common rule comes from module-api, the four
		// test-location rules from unit-testing, and the rest from folder-structure
		expect(docs).toStrictEqual({
			'path-banned-module-name': 'code/architecture/folder-structure',
			'path-common-flat': 'code/architecture/folder-structure',
			'path-common-barrel': 'code/style-guide/structure/module-api',
			'path-test-in-tests-folder': 'tests/unit-testing',
			'path-test-not-colocated': 'tests/unit-testing',
			'path-test-support-in-src': 'tests/unit-testing',
			'path-test-untested-subject-not-public': 'tests/unit-testing',
			'path-folder-casing': 'code/architecture/folder-structure',
			'path-domain-folder-single-file': 'code/architecture/folder-structure',
		});
	});

	test('the path rules ship at the severity each was designed for', async () => {
		const rules = await listStandardsRules({ cwd });
		const severities = Object.fromEntries(rules.filter((rule) => durablePathRules.includes(rule.rule)).map((rule) => [rule.rule, rule.severity]));

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

	test('no path rule carries a number a repo could tune', async () => {
		const rules = await listStandardsRules({ cwd });
		const tunable = rules.filter((rule) => durablePathRules.includes(rule.rule) && Object.keys(rule.settings).length > 0);

		// every threshold in this group is a closed list of names from a doc, never a
		// count — a knob here would be a rule that can be quietly widened until it
		// stops firing
		expect(tunable.map((rule) => rule.rule)).toStrictEqual([]);
	});

	test('a repo that says nothing sees the defaults, unmarked', async () => {
		const rules = await listStandardsRules({ cwd, config: LightsoutConfig.parse(baseConfig) });
		const clone = rules.find((rule) => rule.rule === 'clone');

		expect(clone?.severity).toBe(StandardsSeverity.Advisory);
		expect(clone?.fromConfig).toBe(false);
		// the rule's live numbers travel with it
		expect(clone?.settings).toStrictEqual({ minTokens: 50 });
	});

	test('a rule the config named is marked, so policy reads apart from default', async () => {
		const rules = await listStandardsRules({
			cwd,
			config: LightsoutConfig.parse({ ...baseConfig, standardsChecks: { 'filename-mismatch': 'off', clone: { settings: { minTokens: 90 } } } }),
		});

		const mismatch = rules.find((rule) => rule.rule === 'filename-mismatch');
		const clone = rules.find((rule) => rule.rule === 'clone');

		expect(mismatch?.severity).toBe(StandardsSeverity.Off);
		expect(mismatch?.fromConfig).toBe(true);
		// a settings-only override still counts as policy
		expect(clone?.fromConfig).toBe(true);
		expect(clone?.settings).toStrictEqual({ minTokens: 90 });
		// and every unnamed rule stays unmarked
		expect(rules.filter((rule) => rule.fromConfig).length).toBe(2);
	});

	test('a config key naming no loaded rule refuses the whole listing, and says which ids are real', async () => {
		const error = await getRejectionError({
			promise: listStandardsRules({ cwd, config: LightsoutConfig.parse({ ...baseConfig, standardsChecks: { 'clone-typo': 'off' } }) }),
		});

		// printing a ledger that quietly ignored the typo would confirm a policy
		// the repo does not actually have
		expect(error.message).toContain('standardsChecks names "clone-typo"');
		expect(error.message).toContain('clone');
	});

	test('a row restates what the package author declared, down to the numbers', async () => {
		const { cwd: repo } = setupRepo();

		setupPackage({ cwd: repo, at: 'standards/house', name: 'house', ruleId: 'house-rule', severity: StandardsSeverity.Blocking, settings: { maxLines: 40 } });

		const rules = await listStandardsRules({ cwd: repo, config: LightsoutConfig.parse({ ...baseConfig, standardsPackages: ['standards/house'] }) });

		// nothing in this package ships with the engine, so the row can only have
		// come from the rule's own front matter — including that no code checks it
		expect(rules).toStrictEqual([
			{
				rule: 'house-rule',
				doc: 'house: code/demo',
				summary: 'what house-rule catches',
				checked: false,
				severity: StandardsSeverity.Blocking,
				fromConfig: false,
				settings: { maxLines: 40 },
			},
		]);
	});

	test('rules from several packages are one ledger sorted by id, each row naming the package it came from', async () => {
		const { cwd: repo } = setupRepo();

		setupPackage({ cwd: repo, at: 'standards/house', name: 'house', ruleId: 'zebra-rule' });
		setupPackage({ cwd: repo, at: 'standards/team', name: 'team', ruleId: 'aardvark-rule' });

		const rules = await listStandardsRules({
			cwd: repo,
			config: LightsoutConfig.parse({ ...baseConfig, standardsPackages: ['standards/house', 'standards/team'] }),
		});

		// a reader looking a rule up scans one alphabetical list, not one list per
		// package — and still sees which package to argue with about each rule
		expect(rules.map((rule) => `${rule.rule} → ${rule.doc}`)).toStrictEqual(['aardvark-rule → team: code/demo', 'zebra-rule → house: code/demo']);
	});

	test('a repo that turned standards packages off lists nothing rather than the defaults', async () => {
		const { cwd: repo } = setupRepo();

		const rules = await listStandardsRules({ cwd: repo, config: LightsoutConfig.parse({ ...baseConfig, standardsPackages: false }) });

		// listing the shipped rules here would advertise a policy this repo opted out of
		expect(rules).toStrictEqual([]);
	});

	test('a declared package that cannot load refuses the listing instead of printing a shorter one', async () => {
		const { cwd: repo } = setupRepo();

		setupPackage({ cwd: repo, at: 'standards/house', name: 'house', ruleId: 'house-rule' });

		const error = await getRejectionError({
			promise: listStandardsRules({ cwd: repo, config: LightsoutConfig.parse({ ...baseConfig, standardsPackages: ['standards/house', 'standards/ghost'] }) }),
		});

		// a ledger missing the half that failed to load reads as a repo that enforces less than it does
		expect(error.message).toContain('standards package root file not found');
		expect(error.message).toContain(join(repo, 'standards/ghost', 'lightsout-standards.json'));
	});
});
