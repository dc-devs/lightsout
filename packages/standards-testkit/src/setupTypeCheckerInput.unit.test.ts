import { describe, expect, test } from '@jest/globals';
import type { TypeCheckerInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import ts from 'typescript';
import { setupTypeCheckerInput } from '#src/index.ts';

/** The arm under test, narrowed — every case here builds a type-checker input. */
const setupTyped = ({ sources }: { sources: Array<[string, string]> }) => setupTypeCheckerInput({ sources }) as TypeCheckerInput;

describe('setupTypeCheckerInput', () => {
	test('builds the arm a type-checker check narrows to', () => {
		expect(setupTypeCheckerInput().kind).toBe(StandardsInputKind.TypeChecker);
	});

	test('keys each typed file by the path it was given, not the absolute one the program holds', () => {
		const input = setupTyped({ sources: [['src/app.ts', 'export const total = 1 + 2;\n']] });

		expect([...input.typedFiles.keys()]).toStrictEqual(['src/app.ts']);
	});

	test('resolves a type declared in another file, which is the whole point of this input', () => {
		const input = setupTyped({
			sources: [
				['src/common/types/Total.ts', 'export type Total = 3;\n'],
				['src/app.ts', "import type { Total } from './common/types/Total.ts';\n\nexport const total: Total = 3;\n"],
			],
		});
		const entry = input.typedFiles.get('src/app.ts');
		const declared = entry?.sourceFile.statements.flatMap((statement) =>
			ts.isVariableStatement(statement) ? statement.declarationList.declarations.map((declaration) => declaration.name) : [],
		);

		// An unresolved import does not fail — it types the importer as `any`, and
		// a rule reading that reports nothing. Naming the resolved type is the only
		// assertion that tells the two apart.
		expect(declared?.map((name) => entry?.checker.typeToString(entry.checker.getTypeAtLocation(name)))).toStrictEqual(['3']);
	});

	test('an import of something outside the arranged files resolves to nothing rather than throwing', () => {
		const input = setupTyped({ sources: [['src/app.ts', "import { readFile } from 'node:fs';\n\nexport const read = readFile;\n"]] });

		// A rule's fixture arranges only what the rule reads; a stray import of a
		// real package is not a reason for the whole program to fail to build.
		expect(input.typedFiles.get('src/app.ts')?.sourceFile.statements).toHaveLength(2);
	});

	test('sets parent pointers, which checks walk upward through', () => {
		const input = setupTyped({ sources: [['src/app.ts', 'export const total = 1;\n']] });
		const [statement] = input.typedFiles.get('src/app.ts')?.sourceFile.statements ?? [];

		expect(statement?.parent).toBeDefined();
	});

	test('carries a real compiler, so a check can call the same API the engine hands it', () => {
		const input = setupTyped({ sources: [] });

		expect(typeof input.compiler.createSourceFile).toBe('function');
	});

	test('the paths given become both the source and the file list', () => {
		const input = setupTyped({
			sources: [
				['src/a.ts', ''],
				['src/b.ts', ''],
			],
		});

		expect(input).toMatchObject({ source: ['src/a.ts', 'src/b.ts'], files: ['src/a.ts', 'src/b.ts'] });
	});
});
