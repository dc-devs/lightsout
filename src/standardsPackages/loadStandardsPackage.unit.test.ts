import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { loadStandardsPackage } from '@/standardsPackages';
import { getRejectionError } from '@tests/helpers/getRejectionError';

/** A temp standards package holding the given package-relative files, plus any empty folders. */
const setupPackage = ({ files = {}, folders = [] }: { files?: Record<string, string>; folders?: string[] } = {}) => {
	const packagePath = mkdtempSync(join(tmpdir(), 'lightsout-package-'));

	for (const folder of folders) {
		mkdirSync(join(packagePath, folder), { recursive: true });
	}

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packagePath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { packagePath };
};

/** The root file every valid package carries. */
const rootFile = { 'lightsout-standards.json': '{ "name": "acme", "formatVersion": 1 }\n' };

/** One rule folder's files: its markdown plus the fixture pair every rule ships. */
const ruleFiles = ({ path, markdown }: { path: string; markdown: string }) => ({
	[`${path}/rule.md`]: markdown,
	[`${path}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
	[`${path}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
});

describe('loadStandardsPackage', () => {
	test('reads documents and their rules in folder order, stamping the document channel onto every rule', async () => {
		const { packagePath } = setupPackage({
			files: {
				...rootFile,
				'code/architecture/decisions/document.md': '# Architecture Decisions\n\nUniversal decisions.\n',
				...ruleFiles({
					path: 'code/architecture/decisions/02-graduation-rule',
					markdown: '---\nsummary: a concept earns its folder\nseverity: blocking\nsettings:\n  maxFiles: 20\n---\n\nEvery concept starts as a file.\n',
				}),
				...ruleFiles({
					path: 'code/architecture/decisions/01-module-boundaries',
					markdown: '---\nsummary: cross-module imports go through index.ts\n---\n\nA folder-module has a public API.\n',
				}),
				'tests/unit-testing/document.md': '---\nchannel: react\n---\n\n# Unit Testing\n\nHow to write tests.\n',
				...ruleFiles({ path: 'tests/unit-testing/01-mock-prefix', markdown: '---\nsummary: mock variables carry a mock prefix\n---\n\nName mocks so they read as mocks.\n' }),
			},
		});

		const pkg = await loadStandardsPackage({ packagePath });
		const decisions = pkg.documents.find((document) => document.path === 'code/architecture/decisions');
		const unitTesting = pkg.documents.find((document) => document.path === 'tests/unit-testing');
		const graduation = pkg.rules.find((rule) => rule.id === 'graduation-rule');
		const boundaries = pkg.rules.find((rule) => rule.id === 'module-boundaries');
		const mockPrefix = pkg.rules.find((rule) => rule.id === 'mock-prefix');

		// the root file names the package and the format it is written against
		expect(pkg.name).toBe('acme');
		expect(pkg.formatVersion).toBe(1);
		expect(pkg.rootPath).toBe(packagePath);
		// both trees are walked
		expect(pkg.documents).toHaveLength(2);
		expect(decisions?.set).toBe('code');
		expect(unitTesting?.set).toBe('tests');
		// the numeric prefix orders assembly, not the id
		expect(decisions?.ruleIds).toStrictEqual(['module-boundaries', 'graduation-rule']);
		// a document declaring no channel is base; one that declares a channel stamps it on its rules
		expect(decisions?.channel).toBe('base');
		expect(boundaries?.channel).toBe('base');
		expect(unitTesting?.channel).toBe('react');
		expect(mockPrefix?.channel).toBe('react');
		// the document's body is its intro, front matter stripped
		expect(unitTesting?.intro).toBe('# Unit Testing\n\nHow to write tests.');
		// a rule carries its declaration and its full prose
		expect(graduation?.summary).toBe('a concept earns its folder');
		expect(graduation?.prose).toBe('Every concept starts as a file.');
		expect(graduation?.defaultSeverity).toBe('blocking');
		expect(graduation?.defaultSettings).toStrictEqual({ maxFiles: 20 });
		expect(graduation?.fixturesPath).toBe(join(packagePath, 'code/architecture/decisions/02-graduation-rule/fixtures'));
		// silence means judgment-only and advisory — the two defaults a rule need not restate
		expect(boundaries?.checked).toBe(false);
		expect(boundaries?.defaultSeverity).toBe('advisory');
		expect(boundaries?.defaultSettings).toStrictEqual({});
		// no check declared, so no check loaded
		expect(boundaries?.inputKind).toBe(undefined);
		expect(boundaries?.run).toBe(undefined);
	});

	test('reports every structural and honesty problem in one error rather than the first', async () => {
		const { packagePath } = setupPackage({
			folders: ['code/style/patterns/04-empty-fixtures/fixtures/pass'],
			files: {
				...rootFile,
				'code/style/patterns/document.md': '# Patterns\n',
				...ruleFiles({ path: 'code/style/patterns/no-prefix', markdown: '---\nsummary: unordered\n---\n\nProse.\n' }),
				...ruleFiles({ path: 'code/style/patterns/01-checked-without-check', markdown: '---\nsummary: claims a check\nchecked: true\n---\n\nProse.\n' }),
				...ruleFiles({ path: 'code/style/patterns/02-stray-check', markdown: '---\nsummary: ships an undeclared check\n---\n\nProse.\n' }),
				'code/style/patterns/02-stray-check/check.ts': 'export const check = { inputKind: "file-list", run: () => [] };\n',
				...ruleFiles({ path: 'code/style/patterns/03-no-summary', markdown: '---\nchecked: false\n---\n\nProse.\n' }),
				'code/style/patterns/04-empty-fixtures/rule.md': '---\nsummary: ships no fixtures\n---\n\nProse.\n',
				...ruleFiles({ path: 'code/style/patterns/05-shared-id', markdown: '---\nsummary: first claimant\n---\n\nProse.\n' }),
				'tests/unit-testing/document.md': '# Unit Testing\n',
				...ruleFiles({ path: 'tests/unit-testing/06-shared-id', markdown: '---\nsummary: second claimant\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: loadStandardsPackage({ packagePath }) });

		// one error, naming the package and listing every fault: ${error.message}
		expect(error.message.startsWith(`standards package failed to load (${packagePath}):`)).toBeTruthy();
		expect(error.message).toContain('code/style/patterns/no-prefix: rule folder must be named <NN>-<rule-id>');
		expect(error.message).toContain('code/style/patterns/01-checked-without-check: declares checked: true but ships no check.ts');
		expect(error.message).toContain('code/style/patterns/02-stray-check: ships a check.ts but does not declare checked: true');
		expect(error.message).toContain('code/style/patterns/03-no-summary/rule.md: summary');
		expect(error.message).toContain('code/style/patterns/04-empty-fixtures: fixtures/pass/ is missing or empty');
		expect(error.message).toContain('code/style/patterns/04-empty-fixtures: fixtures/fail/ is missing or empty');
		expect(error.message).toContain('duplicate rule id "shared-id"');
	});

	test('refuses a package whose walk finds no document at all', async () => {
		const { packagePath } = setupPackage({ files: { ...rootFile, 'code/style/README.md': '# not a document\n' } });

		const error = await getRejectionError({ promise: loadStandardsPackage({ packagePath }) });

		// a package with nothing to say is a wrong path or a broken tree, never an intent
		expect(error.message).toContain('package declares no documents');
	});

	test('refuses a package whose root file is missing, unparseable, or written against another format', async () => {
		const { packagePath: missing } = setupPackage({ files: { 'code/style/document.md': '# Style\n' } });
		const { packagePath: malformed } = setupPackage({ files: { 'lightsout-standards.json': '{ "name": ' } });
		const { packagePath: wrongVersion } = setupPackage({ files: { 'lightsout-standards.json': '{ "name": "acme", "formatVersion": 2 }' } });

		const missingError = await getRejectionError({ promise: loadStandardsPackage({ packagePath: missing }) });
		const malformedError = await getRejectionError({ promise: loadStandardsPackage({ packagePath: malformed }) });
		const versionError = await getRejectionError({ promise: loadStandardsPackage({ packagePath: wrongVersion }) });

		// each message names the file a reader has to open
		expect(missingError.message).toBe(`standards package root file not found: ${join(missing, 'lightsout-standards.json')}`);
		expect(malformedError.message).toContain(`standards package root file is not valid JSON (${join(malformed, 'lightsout-standards.json')})`);
		expect(versionError.message).toContain(`standards package root file is invalid (${join(wrongVersion, 'lightsout-standards.json')})`);
		expect(versionError.message).toContain('formatVersion');
	});

	test('reports an unreadable document and a rule whose front matter is not YAML', async () => {
		const { packagePath } = setupPackage({
			folders: ['code/unreadable/document.md'],
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				...ruleFiles({ path: 'code/style/01-broken-front-matter', markdown: '---\nsummary: {unclosed\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: loadStandardsPackage({ packagePath }) });

		// a directory named document.md makes the folder look like a document it cannot read
		expect(error.message).toContain('code/unreadable/document.md: unreadable');
		// malformed YAML quotes the line the author has to look at
		expect(error.message).toContain('code/style/01-broken-front-matter/rule.md: front matter is not valid YAML');
	});

	test('reports a document whose own front matter is not YAML', async () => {
		const { packagePath } = setupPackage({
			files: {
				...rootFile,
				'code/style/document.md': '---\nchannel: {unclosed\n---\n\n# Style\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: loadStandardsPackage({ packagePath }) });

		// the document is named alongside the line the author has to look at
		expect(error.message).toContain('code/style/document.md: front matter is not valid YAML (starting "channel: {unclosed")');
	});

	test('refuses a document whose channel is not a name, dropping the document and the rules it owns', async () => {
		const { packagePath } = setupPackage({
			files: {
				...rootFile,
				'code/style/document.md': '---\nchannel: 5\n---\n\n# Style\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: loadStandardsPackage({ packagePath }) });

		// a channel decides whether the document applies at all, so a broken one cannot be defaulted past
		expect(error.message).toContain('code/style/document.md: channel');
		// with the document dropped, its rules go too — nothing survives to be counted as a document
		expect(error.message).toContain('package declares no documents');
	});

	test('reports a rule whose rule.md cannot be read', async () => {
		const { packagePath } = setupPackage({
			folders: ['code/style/01-unreadable/rule.md'],
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				'code/style/01-unreadable/fixtures/pass/src/example.ts': 'export const example = 1;\n',
				'code/style/01-unreadable/fixtures/fail/src/example.ts': 'export const example = 2;\n',
			},
		});

		const error = await getRejectionError({ promise: loadStandardsPackage({ packagePath }) });

		// a directory named rule.md makes the folder look like a rule whose declaration cannot be read
		expect(error.message).toContain('code/style/01-unreadable/rule.md: unreadable — ');
	});

	test('walks past folders carrying no marker file and stops descending at a document', async () => {
		const { packagePath } = setupPackage({
			files: {
				...rootFile,
				'code/common/utils/shared.ts': 'export const shared = 1;\n',
				'code/style/document.md': '# Style\n',
				'code/style/common/helper.ts': 'export const helper = 1;\n',
				'code/style/nested/document.md': '# Nested\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
			},
		});

		const pkg = await loadStandardsPackage({ packagePath });

		// the package's own helper folders are not documents, and a document's subtree holds only its rule folders
		expect(pkg.documents.map((document) => document.path)).toStrictEqual(['code/style']);
		expect(pkg.documents[0]?.ruleIds).toStrictEqual(['functions']);
		expect(pkg.rules.map((rule) => rule.id)).toStrictEqual(['functions']);
	});
});
