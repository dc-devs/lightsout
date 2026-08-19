import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A suite asserting with `toStrictEqual` and whatever argument is given — the assertion sits on line 5. */
const buildStrictEqualSource = ({ argument }: { argument: string }) =>
	[
		"describe('subject', () => {",
		"\ttest('matches the result', () => {",
		"\t\tconst result = { id: 'a', size: 2 };",
		'',
		`\t\texpect(result).toStrictEqual(${argument});`,
		'\t});',
		'});',
	].join('\n');

/** A file whose sample data quotes the very pairing the rule bans — a mention, not a use. */
const quotedSampleSource = [
	"const sampleLine = 'expect(result).toStrictEqual(expect.any(String));';",
	'',
	"describe('subject', () => {",
	"\ttest('carries its sample line untouched', () => {",
	"\t\texpect(sampleLine).toContain('toStrictEqual');",
	'\t});',
	'});',
].join('\n');

/** Two misleading assertions in one file, on lines 5 and 9. */
const twoMisleadingSource = [
	"describe('subject', () => {",
	"\ttest('matches part of the result', () => {",
	"\t\tconst result = { id: 'a', size: 2 };",
	'',
	"\t\texpect(result).toStrictEqual(expect.objectContaining({ id: 'a' }));",
	'\t});',
	'',
	"\ttest('matches part of the list', () => {",
	"\t\texpect(['a']).toStrictEqual(expect.arrayContaining(['a']));",
	'\t});',
	'});',
].join('\n');

describe('test-strict-equal-matcher check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports toStrictEqual handed an asymmetric matcher, naming the line', async () => {
		const input = setupTestFileInput({
			contents: [['src/feature/getLabel.unit.test.ts', buildStrictEqualSource({ argument: "expect.objectContaining({ id: 'a' })" })]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-strict-equal-matcher:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 5, endLine: 5 }],
				detail: 'toStrictEqual with an asymmetric matcher at line(s) 5',
				guidance: 'Jest runs only the matcher, so the strict extra-property checks never fire — write `toEqual`, or assert a concrete object.',
			},
		]);
	});

	test.each([
		{ argument: "expect.arrayContaining(['a'])" },
		{ argument: 'expect.any(String)' },
		{ argument: "expect.stringContaining('a')" },
		{ argument: "expect.stringMatching('a')" },
	])('reports `$argument` as an asymmetric matcher too', async ({ argument }) => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', buildStrictEqualSource({ argument })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.detail)).toStrictEqual(['toStrictEqual with an asymmetric matcher at line(s) 5']);
	});

	test('leaves toStrictEqual on a concrete object alone — that is what the matcher is for', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', buildStrictEqualSource({ argument: "{ id: 'a', size: 2 }" })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a quoted sample line alone — the rule reads what a file does, not what it quotes', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', quotedSampleSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names every misleading assertion of one file in a single finding', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', twoMisleadingSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-strict-equal-matcher:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 5, endLine: 5 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 9, endLine: 9 },
				],
				detail: 'toStrictEqual with an asymmetric matcher at line(s) 5, 9',
				guidance: 'Jest runs only the matcher, so the strict extra-property checks never fire — write `toEqual`, or assert a concrete object.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
