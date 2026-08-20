import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type FileTextInput, type StandardsCheckInput, type StandardsCheckRun, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import type { ResolvedRuleState } from '#src/standardsCheck/common/types/ResolvedRuleState.ts';
import { runPackageChecks } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '#src/standardsPackages/index.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';

/** One loaded package holding a single rule of the asked-for kind, plus the recorder of what it was handed. */
const loadOneRule = ({ inputKind }: { inputKind: StandardsInputKind }) => {
	const inputs: StandardsCheckInput[] = [];
	const run: StandardsCheckRun = ({ input }) => {
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
	const packages: LoadedStandardsPackage[] = [{ name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules: [rule] }];
	const states = new Map<string, ResolvedRuleState>([['a-rule', { severity: StandardsSeverity.Advisory, settings: {}, fromConfig: false }]]);

	return { inputs, packages, states };
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

/** A workspace package that declares its aliases in its manifest, under a repo whose root carries a tsconfig. */
const setupFileTextRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-inputs-text-'));

	mkdirSync(join(cwd, 'packages/engine/src'), { recursive: true });
	writeFileSync(join(cwd, 'packages/engine/src/alpha.ts'), "import { beta } from '#src/beta.ts';\n\nexport const alpha = beta;\n");
	writeFileSync(join(cwd, 'packages/engine/package.json'), '{ "name": "@acme/engine", "imports": { "#src/*": "./src/*" } }\n');
	writeFileSync(join(cwd, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n');

	return { cwd, ...loadOneRule({ inputKind: StandardsInputKind.FileText }) };
};

/** The one file-text input the run built, narrowed out of the closed kind union. */
const fileTextInput = ({ inputs }: { inputs: StandardsCheckInput[] }): FileTextInput => {
	const input = inputs[0];

	if (input?.kind !== StandardsInputKind.FileText) {
		throw new Error(`expected a file-text input, got ${input?.kind ?? 'none'}`);
	}

	return input;
};

describe('runPackageChecks', () => {
	test('hands a file-text rule both alias sources above a file — the package manifest and the tsconfig', async () => {
		const { cwd, inputs, packages, states } = setupFileTextRun();

		await runPackageChecks({ cwd, packages, states, channels: [] });

		const input = fileTextInput({ inputs });

		// a package that declares `imports` instead of `compilerOptions.paths`
		// reads as declaring no aliases at all when only the tsconfigs come over,
		// and a rule may open neither file for itself
		expect(input.contents.get('packages/engine/package.json')).toBe('{ "name": "@acme/engine", "imports": { "#src/*": "./src/*" } }\n');
		expect(input.contents.get('tsconfig.json')).toBe('{ "compilerOptions": { "strict": true } }\n');
	});

	test('probes for a manifest in every folder above a file, not the repo root alone', async () => {
		const { cwd, inputs, packages, states } = setupFileTextRun();

		await runPackageChecks({ cwd, packages, states, channels: [] });

		const input = fileTextInput({ inputs });

		// a folder holding neither alias source is simply absent — the "when
		// present" the contract promises, and what makes probing every folder
		// cheaper than deciding in advance which ones are packages
		expect(input.contents.has('packages/engine/src/package.json')).toBe(false);
		expect(input.contents.has('packages/package.json')).toBe(false);
		expect(input.contents.has('package.json')).toBe(false);
	});

	test('hands a test-file rule the test files and their text, and nothing the run read for another kind', async () => {
		const { cwd, inputs, packages, states } = setupTestFileRun();

		await runPackageChecks({ cwd, packages, states, channels: [] });

		// a test-shape rule reaching a source file would be checking something its
		// declared kind does not claim
		expect(inputs[0]).toStrictEqual({
			kind: 'test-file',
			cwd,
			tests: ['src/alpha.unit.test.ts'],
			contents: new Map([['src/alpha.unit.test.ts', "test('alpha', () => {});\n"]]),
		});
	});

	test('hands an import-graph rule the edges resolved among the repo files', async () => {
		const { cwd, inputs, packages, states } = setupImportGraphRun();

		const { notes } = await runPackageChecks({ cwd, packages, states, channels: [] });

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
