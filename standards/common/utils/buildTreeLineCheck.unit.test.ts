import ts from 'typescript';
import { expect, describe, test } from '@jest/globals';
import type { StandardsCheckInput } from '@/contracts';
import { buildTreeLineCheck } from './buildTreeLineCheck.ts';

/** A syntax-tree input holding one parsed file per entry, as the engine builds it. */
const setupTreeInput = ({ files }: { files: Array<[string, string]> }): StandardsCheckInput => ({
	kind: 'syntax-tree',
	cwd: '/repo',
	source: files.map(([path]) => path),
	tests: [],
	files: files.map(([path]) => path),
	referenceFiles: [],
	compiler: ts,
	trees: new Map(files.map(([path, text]) => [path, ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true)])),
	standardsPackages: [],
});

/** An input of a kind a syntax-tree rule is never handed, to prove the narrowing holds. */
const setupOtherKindInput = (): StandardsCheckInput => ({ kind: 'clone-spans', cwd: '/repo', source: ['src/subject.ts'], spans: [] });

/** Reports the 1-based line of every statement — enough to drive the walk without a real rule. */
const everyStatementLine = ({ sourceFile }: { sourceFile: ts.SourceFile }) =>
	sourceFile.statements.map((statement) => sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1);

const setupCheck = () =>
	buildTreeLineCheck({
		rule: 'no-any',
		findLines: everyStatementLine,
		detail: ({ lines }) => `\`any\` at line ${lines.join(', ')}`,
		guidance: 'Name the type.',
	});

describe('buildTreeLineCheck', () => {
	test('declares the syntax-tree input its rules read', () => {
		expect(setupCheck().inputKind).toBe('syntax-tree');
	});

	test('reports one finding per file that has offending lines, carrying the rule wording', () => {
		const input = setupTreeInput({ files: [['src/first.ts', 'const one = 1;\nconst two = 2;\n']] });

		const findings = setupCheck().run({ input, settings: {} });

		// one finding for the file, not one per line — the work is a single pass over it
		expect(findings).toStrictEqual([
			{
				siteKey: 'no-any:src/first.ts',
				files: [{ path: 'src/first.ts' }],
				detail: '`any` at line 1, 2',
				guidance: 'Name the type.',
			},
		]);
	});

	test('walks every file and reports only the offending ones', () => {
		const input = setupTreeInput({
			files: [
				['src/clean.ts', ''],
				['src/dirty.ts', 'const one = 1;\n'],
			],
		});

		const findings = setupCheck().run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'no-any:src/dirty.ts',
				files: [{ path: 'src/dirty.ts' }],
				detail: '`any` at line 1',
				guidance: 'Name the type.',
			},
		]);
	});

	test('returns nothing for an input of any other kind rather than refusing', () => {
		expect(setupCheck().run({ input: setupOtherKindInput(), settings: {} })).toStrictEqual([]);
	});
});
