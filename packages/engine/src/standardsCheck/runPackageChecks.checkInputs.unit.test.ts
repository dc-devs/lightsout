import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import {
	type FileListInput,
	type FileTextInput,
	type StandardsCheckFunction,
	type StandardsCheckInput,
	StandardsInputKind,
	StandardsSeverity,
	type SyntaxTreeInput,
	type TypeCheckerInput,
} from '#src/contracts/index.ts';
import type { ResolvedRuleState } from '#src/standardsCheck/common/types/ResolvedRuleState.ts';
import { runPackageChecks } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';

/** One loaded package holding a single rule of the asked-for kind, plus the recorder of what it was handed. */
const loadOneRule = ({ inputKind }: { inputKind: StandardsInputKind }) => {
	const inputs: StandardsCheckInput[] = [];
	const run: StandardsCheckFunction = ({ input }) => {
		inputs.push(input);

		return [];
	};
	const rule: LoadedStandardsRule = {
		id: 'a-rule',
		set: 'code',
		documentPath: 'code/style-guide/structure/module-api',
		summary: 'a rule',
		prose: 'the argument for the rule',
		channel: 'base',
		checked: true,
		defaultSeverity: StandardsSeverity.Advisory,
		defaultSettings: {},
		fixturesPath: '/packages/acme/a-rule/fixtures',
		inputKind,
		run,
	};
	const packs: LoadedStandardsPack[] = [{ name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules: [rule] }];
	const states = new Map<string, ResolvedRuleState>([['a-rule', { severity: StandardsSeverity.Advisory, settings: {}, fromConfig: false }]]);

	return { inputs, packs, states };
};

/** A repo holding one source file and one test file, checked by a rule that declared the test-file kind. */
const setupTestFileRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-tests-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'src/alpha.unit.test.ts'), "test('alpha', () => {});\n");

	return { cwd, ...loadOneRule({ inputKind: StandardsInputKind.TestFile }) };
};

/** A repo where one file imports another, with a typescript to borrow, checked by a rule that declared the import-graph kind. */
const setupImportGraphRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-graph-'));

	mkdirSync(join(cwd, 'src/feature'), { recursive: true });
	writeFileSync(join(cwd, 'src/feature/internal.ts'), 'export const internal = 1;\n');
	writeFileSync(join(cwd, 'src/consumer.ts'), "import { internal } from './feature/internal.ts';\n\nexport const consumer = () => internal;\n");
	linkTypescript({ dir: cwd });

	return { cwd, ...loadOneRule({ inputKind: StandardsInputKind.ImportGraph }) };
};

/**
 * A repo whose root and one workspace package each ship a manifest, checked by
 * a rule that declared the import-graph kind. The package parent dir is the
 * test's to name: a repo that keeps its packages elsewhere says so in config.
 */
const setupImportGraphDependenciesRun = ({ packagesDir }: { packagesDir: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-graph-deps-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	mkdirSync(join(cwd, packagesDir, 'web'), { recursive: true });
	writeFileSync(join(cwd, 'src/consumer.ts'), 'export const consumer = 1;\n');
	writeFileSync(join(cwd, 'package.json'), '{ "name": "root" }\n');
	writeFileSync(join(cwd, packagesDir, 'web/package.json'), '{ "name": "web", "dependencies": { "@tanstack/react-router": "^1" } }\n');
	linkTypescript({ dir: cwd });

	return { cwd, packagesDir, ...loadOneRule({ inputKind: StandardsInputKind.ImportGraph }) };
};

/** A repo whose root declares a framework, with a typescript to borrow, checked by a rule that declared the syntax-tree kind. */
const setupSyntaxTreeRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-syntax-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/widget.ts'), 'export const widget = () => 1;\n');
	writeFileSync(join(cwd, 'src/widget.unit.test.ts'), "test('widget', () => {});\n");
	writeFileSync(join(cwd, 'package.json'), '{ "name": "@acme/widgets", "dependencies": { "@tanstack/react-router": "^1" } }\n');
	linkTypescript({ dir: cwd });

	return { cwd, ...loadOneRule({ inputKind: StandardsInputKind.SyntaxTree }) };
};

/** A workspace package that declares its aliases in its manifest, under a repo whose root carries a tsconfig. */
const setupFileTextRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-text-'));

	mkdirSync(join(cwd, 'packages/engine/src'), { recursive: true });
	writeFileSync(join(cwd, 'packages/engine/src/alpha.ts'), "import { beta } from '#src/beta.ts';\n\nexport const alpha = beta;\n");
	writeFileSync(join(cwd, 'packages/engine/package.json'), '{ "name": "@acme/engine", "imports": { "#src/*": "./src/*" } }\n');
	writeFileSync(join(cwd, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n');

	return { cwd, ...loadOneRule({ inputKind: StandardsInputKind.FileText }) };
};

/** A repo carrying a standards pack of its own, checked by a rule that declared the file-list kind. */
const setupPackRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-pack-'));

	mkdirSync(join(cwd, 'standards/tests/unit-testing/05-rule'), { recursive: true });
	mkdirSync(join(cwd, 'standards/common/utils'), { recursive: true });
	writeFileSync(join(cwd, 'standards/lightsout-standards.json'), '{ "name": "acme", "formatVersion": 1 }\n');
	writeFileSync(join(cwd, 'standards/tests/unit-testing/05-rule/check.ts'), 'export const check = () => [];\n');
	writeFileSync(join(cwd, 'standards/common/utils/scan.unit.test.ts'), "test('scan', () => {});\n");

	return { cwd, ...loadOneRule({ inputKind: StandardsInputKind.FileList }) };
};

/** A repo whose tsconfig covers its source and its tests, with a typescript to borrow, checked by a rule that declared the type-checker kind. */
const setupTypeCheckerRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-types-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/kind.ts'), "export const Kind = { Added: 'added' } as const;\nexport type Kind = (typeof Kind)[keyof typeof Kind];\n");
	writeFileSync(join(cwd, 'src/kind.unit.test.ts'), "import type { Kind } from './kind';\n\nexport const asserted: Kind = 'added';\n");
	writeFileSync(join(cwd, 'package.json'), '{ "name": "@acme/typed", "dependencies": { "react": "^19.0.0" } }\n');
	writeFileSync(join(cwd, 'tsconfig.json'), '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["src"] }\n');
	linkTypescript({ dir: cwd });

	return { cwd, ...loadOneRule({ inputKind: StandardsInputKind.TypeChecker }) };
};

/** The one file-list input the run built, narrowed out of the closed kind union. */
const fileListInput = ({ inputs }: { inputs: StandardsCheckInput[] }): FileListInput => {
	const input = inputs[0];

	if (input?.kind !== StandardsInputKind.FileList) {
		throw new Error(`expected a file-list input, got ${input?.kind ?? 'none'}`);
	}

	return input;
};

/** The one file-text input the run built, narrowed out of the closed kind union. */
const fileTextInput = ({ inputs }: { inputs: StandardsCheckInput[] }): FileTextInput => {
	const input = inputs[0];

	if (input?.kind !== StandardsInputKind.FileText) {
		throw new Error(`expected a file-text input, got ${input?.kind ?? 'none'}`);
	}

	return input;
};

/** The one syntax-tree input the run built, narrowed out of the closed kind union. */
const syntaxTreeInput = ({ inputs }: { inputs: StandardsCheckInput[] }): SyntaxTreeInput => {
	const input = inputs[0];

	if (input?.kind !== StandardsInputKind.SyntaxTree) {
		throw new Error(`expected a syntax-tree input, got ${input?.kind ?? 'none'}`);
	}

	return input;
};

/** The one type-checker input the run built, narrowed out of the closed kind union. */
const typeCheckerInput = ({ inputs }: { inputs: StandardsCheckInput[] }): TypeCheckerInput => {
	const input = inputs[0];

	if (input?.kind !== StandardsInputKind.TypeChecker) {
		throw new Error(`expected a type-checker input, got ${input?.kind ?? 'none'}`);
	}

	return input;
};

describe('runPackageChecks', () => {
	test('hands a file-text rule both alias sources above a file — the package manifest and the tsconfig', async () => {
		const { cwd, inputs, packs, states } = setupFileTextRun();

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = fileTextInput({ inputs });

		// a package that declares `imports` instead of `compilerOptions.paths`
		// reads as declaring no aliases at all when only the tsconfigs come over,
		// and a rule may open neither file for itself
		expect(input.contents.get('packages/engine/package.json')).toBe('{ "name": "@acme/engine", "imports": { "#src/*": "./src/*" } }\n');
		expect(input.contents.get('tsconfig.json')).toBe('{ "compilerOptions": { "strict": true } }\n');
	});

	test('probes for a manifest in every folder above a file, not the repo root alone', async () => {
		const { cwd, inputs, packs, states } = setupFileTextRun();

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = fileTextInput({ inputs });

		// a folder holding neither alias source is simply absent — the "when
		// present" the contract promises, and what makes probing every folder
		// cheaper than deciding in advance which ones are packages
		expect(input.contents.has('packages/engine/src/package.json')).toBe(false);
		expect(input.contents.has('packages/package.json')).toBe(false);
		expect(input.contents.has('package.json')).toBe(false);
	});

	test('hands a test-file rule the test files and their text, and nothing the run read for another kind', async () => {
		const { cwd, inputs, packs, states } = setupTestFileRun();

		await runPackageChecks({ cwd, packs, states, channels: [] });

		// a test-shape rule reaching a source file would be checking something its
		// declared kind does not claim
		expect(inputs[0]).toStrictEqual({
			kind: 'test-file',
			cwd,
			tests: ['src/alpha.unit.test.ts'],
			contents: new Map([['src/alpha.unit.test.ts', "test('alpha', () => {});\n"]]),
		});
	});

	test('hands a rule the pack roots the walk found, and sorts a pack tests/ document set as source', async () => {
		const { cwd, inputs, packs, states } = setupPackRun();

		await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = fileListInput({ inputs });

		// the roots are the only thing that makes the test-file question
		// answerable inside a pack: under one, `tests/` names a document set whose
		// checks are engine code the rules apply to, while the pack's own test
		// says what it is in its filename
		expect(input).toEqual(
			expect.objectContaining({
				standardsPacks: ['standards'],
				source: ['standards/tests/unit-testing/05-rule/check.ts'],
				tests: ['standards/common/utils/scan.unit.test.ts'],
			}),
		);
	});

	test('hands a syntax-tree rule one parsed tree per source file, and what each package declares alongside it', async () => {
		const { cwd, inputs, packs, states } = setupSyntaxTreeRun();

		const { notes } = await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = syntaxTreeInput({ inputs });

		// an empty note list is what says the compiler resolved: the kind needs one,
		// and a run without it skips the rule instead of building this
		expect(notes).toStrictEqual([]);
		// the trees are the source files alone — a test file is listed for the
		// rules that ask about tests, never parsed for the rules that report on
		// source
		expect([...input.trees.keys()]).toStrictEqual(['src/widget.ts']);
		expect(input.trees.get('src/widget.ts')?.statements.length).toBe(1);
		expect(input).toEqual(
			expect.objectContaining({
				kind: 'syntax-tree',
				source: ['src/widget.ts'],
				tests: ['src/widget.unit.test.ts'],
				dependencies: new Map([['.', ['@tanstack/react-router']]]),
			}),
		);
	});

	test('hands a type-checker rule a checker for every file a tsconfig covers, its tests and pack roots included', async () => {
		const { cwd, inputs, packs, states } = setupTypeCheckerRun();

		const { notes } = await runPackageChecks({ cwd, packs, states, channels: [] });

		const input = typeCheckerInput({ inputs });

		// an empty note list is what says the compiler resolved: the kind needs one,
		// and a run without it skips the rule instead of building this
		expect(notes).toStrictEqual([]);
		// a rule asking "does anything consume this?" needs the consumers typed
		// too, and a consumer may be a test — which of them it may REPORT on is
		// the separate question `source` and `tests` answer
		expect([...input.typedFiles.keys()]).toStrictEqual(['src/kind.ts', 'src/kind.unit.test.ts']);
		expect(input).toEqual(
			expect.objectContaining({
				kind: 'type-checker',
				source: ['src/kind.ts'],
				tests: ['src/kind.unit.test.ts'],
				standardsPacks: [],
				dependencies: new Map([['.', ['react']]]),
			}),
		);
	});

	test('hands an import-graph rule what each package declares, so a boundary rule can tell a framework-mandated folder from one the repo chose', async () => {
		const { cwd, inputs, packs, states } = setupImportGraphDependenciesRun({ packagesDir: 'packages' });

		const { notes } = await runPackageChecks({ cwd, packs, states, channels: [] });

		// an empty note list is what says the compiler resolved: the kind needs one,
		// and a run without it skips the rule instead of building this
		expect(notes).toStrictEqual([]);
		// a carve-out is keyed on what a package DECLARES, and the graph cannot show
		// it — a root that declares nothing still gets an entry, so a rule reading
		// the map never has to tell "no manifest" from "no dependencies"
		expect(inputs[0]).toEqual(
			expect.objectContaining({
				kind: 'import-graph',
				dependencies: new Map([
					['.', []],
					['packages/web', ['@tanstack/react-router']],
				]),
			}),
		);
	});

	test('reads those declarations from the package parent dir the run was configured with, not the default name', async () => {
		const { cwd, packagesDir, inputs, packs, states } = setupImportGraphDependenciesRun({ packagesDir: 'modules' });

		await runPackageChecks({ cwd, packs, states, channels: [], packagesDir });

		// a repo that keeps its packages under another name would otherwise have
		// every workspace manifest fall out of the map, silently
		expect(inputs[0]).toEqual(
			expect.objectContaining({
				dependencies: new Map([
					['.', []],
					['modules/web', ['@tanstack/react-router']],
				]),
			}),
		);
	});

	test('hands an import-graph rule the edges resolved among the repo files', async () => {
		const { cwd, inputs, packs, states } = setupImportGraphRun();

		const { notes } = await runPackageChecks({ cwd, packs, states, channels: [] });

		// an empty note list is what says the compiler resolved: the kind needs one,
		// and a run without it skips the rule instead of building this
		expect(notes).toStrictEqual([]);
		expect(inputs[0]).toEqual(
			expect.objectContaining({
				kind: 'import-graph',
				files: ['src/consumer.ts', 'src/feature/internal.ts'],
				edges: [{ from: 'src/consumer.ts', to: 'src/feature/internal.ts' }],
			}),
		);
	});
});
