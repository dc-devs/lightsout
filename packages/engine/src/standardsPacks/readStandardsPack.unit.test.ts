import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '#src/contracts/index.ts';
import { StandardsInputKind } from '#src/contracts/index.ts';
import { readStandardsPack } from '#src/standardsPacks/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

/** A temp standards pack holding the given pack-relative files, plus any empty folders. */
const setupPack = ({ files = {}, folders = [] }: { files?: Record<string, string>; folders?: string[] } = {}) => {
	const packPath = mkdtempSync(join(tmpdir(), 'lightsout-pack-'));

	for (const folder of folders) {
		mkdirSync(join(packPath, folder), { recursive: true });
	}

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packPath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { packPath };
};

/** The root file every valid pack carries. */
const rootFile = { 'lightsout-standards.json': '{ "name": "acme", "formatVersion": 1 }\n' };

/** One rule folder's files: its markdown plus the fixture pair every rule ships. */
const ruleFiles = ({ path, markdown }: { path: string; markdown: string }) => ({
	[`${path}/rule.md`]: markdown,
	[`${path}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
	[`${path}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
});

/**
 * The check a rule ships, written the way a pack author writes one: a `check`
 * export naming its input kind, and one finding per file it is handed.
 */
const checkSource =
	'export const check = {\n' +
	"\tinputKind: 'file-list',\n" +
	'\trun: ({ input }) => input.files.map((path) => ({ siteKey: `loose-file:${path}`, files: [{ path }], detail: `${path} sits outside a module` })),\n' +
	'};\n';

/** The engine-built input a file-list check reads — only `files` is what the check above looks at. */
const fileListInput = ({ files }: { files: string[] }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files,
	tests: [],
	files,
	referenceFiles: [],
	dependencies: new Map(),
	standardsPackages: [],
});

describe('readStandardsPack', () => {
	test('reads documents and their rules in folder order, stamping the document channel onto every rule', async () => {
		const { packPath } = setupPack({
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
				...ruleFiles({
					path: 'tests/unit-testing/01-mock-prefix',
					markdown: '---\nsummary: mock variables carry a mock prefix\n---\n\nName mocks so they read as mocks.\n',
				}),
			},
		});

		const pkg = await readStandardsPack({ packPath });
		const decisions = pkg.documents.find((document) => document.path === 'code/architecture/decisions');
		const unitTesting = pkg.documents.find((document) => document.path === 'tests/unit-testing');
		const graduation = pkg.rules.find((rule) => rule.id === 'graduation-rule');
		const boundaries = pkg.rules.find((rule) => rule.id === 'module-boundaries');
		const mockPrefix = pkg.rules.find((rule) => rule.id === 'mock-prefix');

		// the root file names the pack and the format it is written against
		expect(pkg.name).toBe('acme');
		expect(pkg.formatVersion).toBe(1);
		expect(pkg.rootPath).toBe(packPath);
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
		expect(graduation?.fixturesPath).toBe(join(packPath, 'code/architecture/decisions/02-graduation-rule/fixtures'));
		// silence means judgment-only and advisory — the two defaults a rule need not restate
		expect(boundaries?.checked).toBe(false);
		expect(boundaries?.defaultSeverity).toBe('advisory');
		expect(boundaries?.defaultSettings).toStrictEqual({});
		// no check declared, so no check loaded
		expect(boundaries?.inputKind).toBe(undefined);
		expect(boundaries?.run).toBe(undefined);
	});

	test('reads a pack authored with Windows line endings', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '---\r\nchannel: react\r\n---\r\n\r\n# Style\r\n',
				...ruleFiles({
					path: 'code/style/01-functions',
					markdown: '---\r\nsummary: one export per file\r\nseverity: blocking\r\n---\r\n\r\nProse.\r\n',
				}),
			},
		});

		const pkg = await readStandardsPack({ packPath });
		const functions = pkg.rules.find((rule) => rule.id === 'functions');

		// a CRLF file declares exactly what the same LF file would — the markers are found and the prose starts after them
		expect(pkg.documents[0]?.channel).toBe('react');
		expect(pkg.documents[0]?.intro).toBe('# Style');
		expect(functions?.summary).toBe('one export per file');
		expect(functions?.defaultSeverity).toBe('blocking');
		expect(functions?.prose).toBe('Prose.');
	});

	test('reports every structural and honesty problem in one error rather than the first', async () => {
		const { packPath } = setupPack({
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

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// one error, naming the pack and listing every fault: ${error.message}
		expect(error.message.startsWith(`standards pack failed to load (${packPath}):`)).toBeTruthy();
		expect(error.message).toContain('code/style/patterns/no-prefix: rule folder must be named <NN>-<rule-id>');
		expect(error.message).toContain('code/style/patterns/01-checked-without-check: declares checked: true but ships no check.ts');
		expect(error.message).toContain('code/style/patterns/02-stray-check: ships a check.ts but does not declare checked: true');
		expect(error.message).toContain('code/style/patterns/03-no-summary/rule.md: summary');
		expect(error.message).toContain('duplicate rule id "shared-id"');
		// 04-empty-fixtures ships none, and loading does not care: whether a check
		// proves itself against a fixture pair is what `standards-validate` asks.
		expect(error.message).not.toContain('fixture');
	});

	test('refuses a pack whose walk finds no document at all', async () => {
		const { packPath } = setupPack({ files: { ...rootFile, 'code/style/README.md': '# not a document\n' } });

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// a pack with nothing to say is a wrong path or a broken tree, never an intent
		expect(error.message).toContain('pack declares no documents');
	});

	test('an authored pack carries no built marker — its fixtures are still beside its rules', async () => {
		const { packPath } = setupPack({
			files: { ...rootFile, 'code/architecture/decisions/document.md': '# Architecture Decisions\n\nUniversal decisions.\n' },
		});

		const pkg = await readStandardsPack({ packPath });

		expect(pkg.built).toBeUndefined();
	});

	test('a pack the bundler stamped loads as built, which is how validate knows not to blame its rules', async () => {
		const { packPath } = setupPack({
			files: {
				'lightsout-standards.json': '{ "name": "acme", "formatVersion": 1, "built": true }\n',
				'code/architecture/decisions/document.md': '# Architecture Decisions\n\nUniversal decisions.\n',
			},
		});

		const pkg = await readStandardsPack({ packPath });

		expect(pkg.built).toBe(true);
	});

	test('refuses a pack whose root file is missing', async () => {
		const { packPath } = setupPack({ files: { 'code/style/document.md': '# Style\n' } });

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// the message names the file a reader has to open
		expect(error.message).toBe(`standards pack root file not found: ${join(packPath, 'lightsout-standards.json')}`);
	});

	test('refuses a pack whose root file will not parse', async () => {
		const { packPath } = setupPack({ files: { 'lightsout-standards.json': '{ "name": ' } });

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		expect(error.message).toContain(`standards pack root file is not valid JSON (${join(packPath, 'lightsout-standards.json')})`);
	});

	test('refuses a pack written against another format version', async () => {
		const { packPath } = setupPack({ files: { 'lightsout-standards.json': '{ "name": "acme", "formatVersion": 2 }' } });

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		expect(error.message).toContain(`standards pack root file is invalid (${join(packPath, 'lightsout-standards.json')})`);
		expect(error.message).toContain('formatVersion');
	});

	test('reports an unreadable document and a rule whose front matter is not YAML', async () => {
		const { packPath } = setupPack({
			folders: ['code/unreadable/document.md'],
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				...ruleFiles({ path: 'code/style/01-broken-front-matter', markdown: '---\nsummary: {unclosed\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// a directory named document.md makes the folder look like a document it cannot read
		expect(error.message).toContain('code/unreadable/document.md: unreadable');
		// malformed YAML quotes the line the author has to look at
		expect(error.message).toContain('code/style/01-broken-front-matter/rule.md: front matter is not valid YAML');
	});

	test('reports a document whose own front matter is not YAML', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '---\nchannel: {unclosed\n---\n\n# Style\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// the document is named alongside the line the author has to look at
		expect(error.message).toContain('code/style/document.md: front matter is not valid YAML (starting "channel: {unclosed")');
	});

	test('refuses a document whose channel is not a name, dropping the document and the rules it owns', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '---\nchannel: 5\n---\n\n# Style\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// a channel decides whether the document applies at all, so a broken one cannot be defaulted past
		expect(error.message).toContain('code/style/document.md: channel');
		// with the document dropped, its rules go too — nothing survives to be counted as a document
		expect(error.message).toContain('pack declares no documents');
	});

	test('treats a front matter block that is not a set of declarations as declaring nothing', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '---\n- one\n- two\n---\n\n# Style\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\n- one\n- two\n---\n\nProse.\n' }),
			},
		});

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// a YAML list names no fields, so the document falls back to base rather than failing
		expect(error.message).not.toContain('code/style/document.md');
		// the same silence is fatal for a rule, whose summary has no default to fall back on
		expect(error.message).toContain('code/style/01-functions/rule.md: summary');
	});

	test('reports a rule whose rule.md cannot be read', async () => {
		const { packPath } = setupPack({
			folders: ['code/style/01-unreadable/rule.md'],
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				'code/style/01-unreadable/fixtures/pass/src/example.ts': 'export const example = 1;\n',
				'code/style/01-unreadable/fixtures/fail/src/example.ts': 'export const example = 2;\n',
			},
		});

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// a directory named rule.md makes the folder look like a rule whose declaration cannot be read
		expect(error.message).toContain('code/style/01-unreadable/rule.md: unreadable — ');
	});

	test('loads the check a declared rule ships, carrying the input kind it asked for and the function itself', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				...ruleFiles({ path: 'code/style/01-loose-file', markdown: '---\nsummary: a source file outside a module\nchecked: true\n---\n\nProse.\n' }),
				'code/style/01-loose-file/check.ts': checkSource,
			},
		});

		const pkg = await readStandardsPack({ packPath });
		const looseFile = pkg.rules.find((rule) => rule.id === 'loose-file');
		const findings = await looseFile?.run?.({ input: fileListInput({ files: ['src/alpha.ts'] }), settings: {} });

		// the declaration is honest, so the rule carries the kind its check asked for
		expect(looseFile?.checked).toBe(true);
		expect(looseFile?.inputKind).toBe('file-list');
		// the function on the rule is the pack's own — what it returns is what a run would see
		expect(findings).toStrictEqual([{ siteKey: 'loose-file:src/alpha.ts', files: [{ path: 'src/alpha.ts' }], detail: 'src/alpha.ts sits outside a module' }]);
	});

	test('reports a rule whose check.ts exports no usable check, and drops the rule', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				...ruleFiles({ path: 'code/style/01-bad-check', markdown: '---\nsummary: ships a check it cannot load\nchecked: true\n---\n\nProse.\n' }),
				'code/style/01-bad-check/check.ts': 'export const check = 5;\n',
			},
		});

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// the rule folder is named alongside the file the author has to open
		expect(error.message).toContain('code/style/01-bad-check: check.ts must export `check` as { inputKind, run }');
		expect(error.message).toContain(join(packPath, 'code/style/01-bad-check/check.ts'));
	});

	test('reports a rule whose check.ts cannot be imported at all', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				...ruleFiles({ path: 'code/style/01-throwing-check', markdown: '---\nsummary: ships a check that fails on import\nchecked: true\n---\n\nProse.\n' }),
				'code/style/01-throwing-check/check.ts': "throw new Error('this check cannot initialise');\n",
			},
		});

		const error = await getRejectionError({ promise: readStandardsPack({ packPath }) });

		// an import that blows up is the rule's fault to report, never the loader's to crash on
		expect(error.message).toContain('code/style/01-throwing-check: this check cannot initialise');
	});

	test('walks past folders carrying no marker file and stops descending at a document', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/common/utils/shared.ts': 'export const shared = 1;\n',
				'code/style/document.md': '# Style\n',
				'code/style/common/helper.ts': 'export const helper = 1;\n',
				'code/style/nested/document.md': '# Nested\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
			},
		});

		const pkg = await readStandardsPack({ packPath });

		// the pack's own helper folders are not documents, and a document's subtree holds only its rule folders
		expect(pkg.documents.map((document) => document.path)).toStrictEqual(['code/style']);
		expect(pkg.documents[0]?.ruleIds).toStrictEqual(['functions']);
		expect(pkg.rules.map((rule) => rule.id)).toStrictEqual(['functions']);
	});
});
