import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('type-alias-indirection check', () => {
	test('asks for parsed trees, since a rename and a derivation differ by two characters', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a file whose only export renames another type', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/common/types/FilterOptions.ts', "import type { TableFilterState } from './TableFilterState';\n\nexport type FilterOptions = TableFilterState;\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'type-alias-indirection:src/common/types/FilterOptions.ts',
				files: [{ path: 'src/common/types/FilterOptions.ts' }],
				detail: "the file's only export is a type alias renaming another type, at line 3",
				guidance:
					'Use the original type directly and delete the file — where the semantic distinction matters, a comment at the usage site says it more cheaply than a hop.',
			},
		]);
	});

	test('a derivation is not a rename — type arguments compute a type rather than copy its name', async () => {
		// `z.infer<typeof Schema>` and `ReturnType<typeof make>` are references too,
		// and neither gives an existing type a second name
		const input = setupSyntaxTreeInput({
			sources: [['src/common/types/Config.ts', 'export type Config = ReturnType<typeof buildConfig>;\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('an alias beside the code that uses it is a local convenience, not a file of indirection', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/issues/getIssueQuery.ts',
					'export type Filters = TableFilterState;\n\nexport const getIssueQuery = ({ filters }: { filters: Filters }): string => filters.query;\n',
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a generic alias is a shape of its own, whatever it wraps', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/common/types/Boxed.ts', 'export type Boxed<T> = Container<T>;\n']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('answers nothing for an input kind it did not ask for', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
