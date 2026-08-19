import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A suite holding one nested describe under the title given — the nested block runs from line 2 to line 4. */
const buildNestedSource = ({ title }: { title: string }) =>
	["describe('getLabel', () => {", `\tdescribe('${title}', () => {`, "\t\ttest('trims it', () => {});", '\t});', '});'].join('\n');

/** Two plainly titled describes inside one suite, opening on lines 2 and 5. */
const twoNestedSource = [
	"describe('getLabel', () => {",
	"\tdescribe('padded names', () => {",
	"\t\ttest('trims it', () => {});",
	'\t});',
	"\tdescribe('empty names', () => {",
	"\t\ttest('falls back', () => {});",
	'\t});',
	'});',
].join('\n');

/** Two suites side by side, neither one inside the other. */
const siblingSuitesSource = [
	"describe('getLabel', () => {",
	"\ttest('trims it', () => {});",
	'});',
	'',
	"describe('getFallbackLabel', () => {",
	"\ttest('falls back', () => {});",
	'});',
].join('\n');

describe('test-nested-describe check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a nested describe whose title names neither a condition nor a variant', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', buildNestedSource({ title: 'padded names' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-nested-describe:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 4 }],
				detail: "'padded names' (line 2) nested inside another describe",
				guidance: 'Keep describe blocks flat — scenario variants come from `setup()` parameters, or from a `when …` / `for …` title.',
			},
		]);
	});

	test.each([
		{ title: 'when the name is padded', names: 'a condition' },
		{ title: 'for the padded variant', names: 'a variant' },
	])('leaves a nested describe titling $names alone', async ({ title }) => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', buildNestedSource({ title })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves suites sitting side by side alone — the rule reads nesting, not the count of describes', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', siblingSuitesSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names every nested describe of one file in a single finding, each with its own line', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', twoNestedSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-nested-describe:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 4 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 5, endLine: 7 },
				],
				detail: "'padded names' (line 2), 'empty names' (line 5) nested inside another describe",
				guidance: 'Keep describe blocks flat — scenario variants come from `setup()` parameters, or from a `when …` / `for …` title.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
