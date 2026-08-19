import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import type ts from 'typescript';
import { buildTreeLineCheck } from './buildTreeLineCheck.ts';

/** Reports the 1-based line of every statement — enough to drive the walk without a real rule. */
const everyStatementLine = ({ sourceFile }: { sourceFile: ts.SourceFile }) =>
	sourceFile.statements.map((statement) => sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1);

const buildCheck = () =>
	buildTreeLineCheck({
		rule: 'no-any',
		findLines: everyStatementLine,
		detail: ({ lines }) => `\`any\` at line ${lines.join(', ')}`,
		guidance: 'Name the type.',
	});

describe('buildTreeLineCheck', () => {
	test('declares the syntax-tree input its rules read', () => {
		expect(buildCheck().inputKind).toBe('syntax-tree');
	});

	test('reports one finding per file that has offending lines, carrying the rule wording', () => {
		const input = setupSyntaxTreeInput({ sources: [['src/first.ts', 'const one = 1;\nconst two = 2;\n']] });

		const findings = buildCheck().run({ input, settings: {} });

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
		const input = setupSyntaxTreeInput({
			sources: [
				['src/clean.ts', ''],
				['src/dirty.ts', 'const one = 1;\n'],
			],
		});

		const findings = buildCheck().run({ input, settings: {} });

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
		const findings = buildCheck().run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
