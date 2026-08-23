import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig, StandardsSeverity } from '#src/contracts/index.ts';
import { listStandardsRules } from '#src/standardsCheck/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

const baseConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false as const } };

/**
 * The repo the listing is read for — the shipped pack answers regardless,
 * since it travels with the engine.
 *
 * The workspace root rather than the working directory: this suite runs from
 * inside the engine package, and one case below looks up a document inside the
 * standards pack, which is a sibling rather than a child.
 */
const cwd = join(__dirname, '..', '..', '..', '..');

/**
 * The rule ids that predate the pack format. A repo's baseline keys, its
 * config overrides and its frozen refactor work-lists are all written in these
 * strings, so one of them going missing is a silent break in persisted data —
 * which is why they are restated here rather than read back off the pack.
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

/** 'lightsout-defaults: code/…' split back into the pack name and the document folder the row names. */
const docPartsOf = ({ doc }: { doc: string }) => {
	const [name, path] = doc.split(': ');

	return { name: name ?? '', path: path ?? '' };
};

interface PackSpec {
	/** Repo-relative folder the pack is written under. */
	at: string;
	name: string;
	ruleId: string;
	severity?: typeof StandardsSeverity.Blocking | typeof StandardsSeverity.Advisory;
	settings?: Record<string, number>;
}

/**
 * A judgment-only standards pack written under `at`, holding one rule that
 * declares whatever the caller passes. Nothing here is shipped by the engine,
 * so a row read back off it proves the listing carries the pack author's own
 * words rather than the defaults.
 */
const writePack = ({ cwd, at, name, ruleId, severity = StandardsSeverity.Advisory, settings = {} }: PackSpec & { cwd: string }) => {
	const packPath = join(cwd, at);
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
		const absolutePath = join(packPath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}
};

/** A temp consumer repo holding the given packs — the listing reads exactly the packs its config declares. */
const setupRepo = ({ packs = [] }: { packs?: PackSpec[] } = {}) => {
	const repoCwd = mkdtempSync(join(tmpdir(), 'lightsout-list-rules-'));

	for (const spec of packs) {
		writePack({ cwd: repoCwd, ...spec });
	}

	return { cwd: repoCwd };
};

describe('listStandardsRules', () => {
	test('lists every rule the loaded packs declare, sorted by id', async () => {
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
		// rules that had a check before the pack format existed
		expect(rules.filter((rule) => durableRuleIds.includes(rule.rule) && !rule.checked).map((rule) => rule.rule)).toStrictEqual([]);
	});

	test('every rule names the pack that states it and a document folder inside that pack', async () => {
		const rules = await listStandardsRules({ cwd });

		// the doc column is what makes the output actionable — a row naming a
		// document that is not there sends the reader nowhere
		const missing = rules.filter((rule) => {
			const { name, path } = docPartsOf({ doc: rule.doc });

			return name !== 'lightsout-defaults' || !existsSync(join(cwd, 'packages', 'standards-typescript', path, 'document.md'));
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

	test('the path rules ship advisory — the default pack blocks only what is wrong on its own terms', async () => {
		const rules = await listStandardsRules({ cwd });
		const severities = Object.fromEntries(rules.filter((rule) => durablePathRules.includes(rule.rule)).map((rule) => [rule.rule, rule.severity]));

		// every path rule is a layout opinion — where a file goes, what a folder
		// is called, where a test sits. The pack reports them and hands them to
		// the refactor agent, but does not block a repository on day one for a
		// layout it has not agreed to; a strict repo promotes them in its own
		// standards-checks, as this repository does
		expect(severities).toStrictEqual({
			'path-banned-module-name': StandardsSeverity.Advisory,
			'path-common-flat': StandardsSeverity.Advisory,
			'path-common-barrel': StandardsSeverity.Advisory,
			'path-test-in-tests-folder': StandardsSeverity.Advisory,
			'path-test-not-colocated': StandardsSeverity.Advisory,
			'path-test-support-in-src': StandardsSeverity.Advisory,
			'path-test-untested-subject-not-public': StandardsSeverity.Advisory,
			'path-folder-casing': StandardsSeverity.Advisory,
			'path-domain-folder-single-file': StandardsSeverity.Advisory,
		});
	});

	test('the default pack blocks exactly the rules that are wrong on their own terms', async () => {
		// a repo with no config of its own, so the listing is the pack's defaults
		// rather than this repository's promotions
		const rules = await listStandardsRules({ cwd: setupRepo().cwd });
		const blocking = rules
			.filter((rule) => rule.severity === StandardsSeverity.Blocking)
			.map((rule) => rule.rule)
			.sort();

		// types that lie, code nothing uses, a tree that breaks across
		// filesystems, doc tags another tool owns, and tests that are silently
		// weaker than they read. Everything about layout ships advisory.
		expect(blocking).toStrictEqual([
			'ast-duplicate',
			'brittle-doc-tags',
			'dead-export',
			'explicit-return-type',
			'import-type-only',
			'no-any',
			'path-case-collision',
			'test-assert-in-hook',
			'test-mock-prefix',
			'test-mock-untyped',
			'test-mock-wrapper-untyped',
			'test-shared-let',
			'test-strict-equal-matcher',
			'type-assertion',
		]);
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
			config: LightsoutConfig.parse({ ...baseConfig, 'standards-checks': { 'filename-mismatch': 'off', clone: { settings: { minTokens: 90 } } } }),
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
			promise: listStandardsRules({ cwd, config: LightsoutConfig.parse({ ...baseConfig, 'standards-checks': { 'clone-typo': 'off' } }) }),
		});

		// printing a ledger that quietly ignored the typo would confirm a policy
		// the repo does not actually have
		expect(error.message).toContain('standards-checks names "clone-typo"');
		expect(error.message).toContain('clone');
	});

	test('a row restates what the pack author declared, down to the numbers', async () => {
		const { cwd: repo } = setupRepo({
			packs: [{ at: 'standards/house', name: 'house', ruleId: 'house-rule', severity: StandardsSeverity.Blocking, settings: { maxLines: 40 } }],
		});

		const rules = await listStandardsRules({ cwd: repo, config: LightsoutConfig.parse({ ...baseConfig, 'standards-packs': ['standards/house'] }) });

		// nothing in this pack ships with the engine, so the row can only have
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

	test('rules from several packs are one ledger sorted by id, each row naming the pack it came from', async () => {
		const { cwd: repo } = setupRepo({
			packs: [
				{ at: 'standards/house', name: 'house', ruleId: 'zebra-rule' },
				{ at: 'standards/team', name: 'team', ruleId: 'aardvark-rule' },
			],
		});

		const rules = await listStandardsRules({
			cwd: repo,
			config: LightsoutConfig.parse({ ...baseConfig, 'standards-packs': ['standards/house', 'standards/team'] }),
		});

		// a reader looking a rule up scans one alphabetical list, not one list per
		// pack — and still sees which pack to argue with about each rule
		expect(rules.map((rule) => `${rule.rule} → ${rule.doc}`)).toStrictEqual(['aardvark-rule → team: code/demo', 'zebra-rule → house: code/demo']);
	});

	test('a repo that turned standards packs off lists nothing rather than the defaults', async () => {
		const { cwd: repo } = setupRepo();

		const rules = await listStandardsRules({ cwd: repo, config: LightsoutConfig.parse({ ...baseConfig, 'standards-packs': false }) });

		// listing the shipped rules here would advertise a policy this repo opted out of
		expect(rules).toStrictEqual([]);
	});

	test('a declared pack that cannot load refuses the listing instead of printing a shorter one', async () => {
		const { cwd: repo } = setupRepo({ packs: [{ at: 'standards/house', name: 'house', ruleId: 'house-rule' }] });

		const error = await getRejectionError({
			promise: listStandardsRules({
				cwd: repo,
				config: LightsoutConfig.parse({ ...baseConfig, 'standards-packs': ['standards/house', 'standards/ghost'] }),
			}),
		});

		// a ledger missing the half that failed to load reads as a repo that enforces less than it does
		expect(error.message).toContain('standards pack root file not found');
		expect(error.message).toContain(join(repo, 'standards/ghost', 'lightsout-standards.json'));
	});
});
