import ts from 'typescript';
import { expect, describe, test } from '@jest/globals';
import type { SyntaxTreeInput } from '@/contracts';
import { buildTreeLineFindings } from './buildTreeLineFindings.ts';

/** A syntax-tree input holding one parsed file per entry, as the engine builds it. */
const setupInput = ({ files }: { files: Array<[string, string]> }): SyntaxTreeInput => ({
	kind: 'syntax-tree',
	cwd: '/repo',
	source: files.map(([path]) => path),
	tests: [],
	files: files.map(([path]) => path),
	referenceFiles: [],
	compiler: ts,
	trees: new Map(files.map(([path, text]) => [path, ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true)])),
});

/** Reports the 1-based line of every statement in the file — enough to drive the walk without a real rule. */
const everyStatementLine = ({ sourceFile }: { sourceFile: ts.SourceFile }) =>
	sourceFile.statements.map((statement) => sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1);

/** Finds nothing, whatever it is handed. */
const noLines = () => [];

describe('buildTreeLineFindings', () => {
	test('reports one finding per file that has offending lines, carrying the rule wording', () => {
		const input = setupInput({ files: [['src/first.ts', 'const one = 1;\nconst two = 2;\n']] });

		const findings = buildTreeLineFindings({
			input,
			rule: 'no-any',
			findLines: everyStatementLine,
			detail: ({ lines }) => `\`any\` at line ${lines.join(', ')}`,
			guidance: 'Name the type.',
		});

		expect(findings).toStrictEqual([
			{
				siteKey: 'no-any:src/first.ts',
				files: [{ path: 'src/first.ts' }],
				detail: '`any` at line 1, 2',
				guidance: 'Name the type.',
			},
		]);
	});

	test('a file with no offending line produces no finding, so a clean file is silent', () => {
		const input = setupInput({ files: [['src/clean.ts', 'const one = 1;\n']] });

		const findings = buildTreeLineFindings({
			input,
			rule: 'no-any',
			findLines: noLines,
			detail: ({ lines }) => `at ${lines.join(', ')}`,
			guidance: 'Name the type.',
		});

		expect(findings).toStrictEqual([]);
	});

	test('every file is walked, and only the offending ones are reported', () => {
		const input = setupInput({
			files: [
				['src/clean.ts', ''],
				['src/dirty.ts', 'const one = 1;\n'],
			],
		});

		const findings = buildTreeLineFindings({
			input,
			rule: 'type-assertion',
			findLines: everyStatementLine,
			detail: ({ lines }) => `\`as\` cast at line ${lines.join(', ')}`,
			guidance: 'Narrow instead.',
		});

		// the empty file has no statements, so it contributes nothing rather than an empty finding
		expect(findings).toStrictEqual([
			{
				siteKey: 'type-assertion:src/dirty.ts',
				files: [{ path: 'src/dirty.ts' }],
				detail: '`as` cast at line 1',
				guidance: 'Narrow instead.',
			},
		]);
	});
});
