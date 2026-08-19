import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** One test calling two arrangement factories — the block runs from line 2 to line 7. */
const twoSetupsSource = [
	"describe('getLabel', () => {",
	"\ttest('trims the name it is given', () => {",
	"\t\tconst { name } = setupLabel({ name: ' Ada ' });",
	'\t\tconst fallback = setupFallbackLabel();',
	'',
	"\t\texpect(getLabel({ name: name || fallback.name })).toBe('Ada');",
	'\t});',
	'});',
].join('\n');

/** One test arranging once, acting once, asserting once. */
const oneSetupSource = [
	"describe('getLabel', () => {",
	"\ttest('trims the name it is given', () => {",
	"\t\tconst { name } = setupLabel({ name: ' Ada ' });",
	'',
	'\t\tconst label = getLabel({ name });',
	'',
	"\t\texpect(label).toBe('Ada');",
	'\t});',
	'});',
].join('\n');

/** Two over-arranged tests in one suite, opening on lines 2 and 9. */
const twoOverArrangedSource = [
	"describe('getLabel', () => {",
	"\ttest('trims the name it is given', () => {",
	"\t\tconst { name } = setupLabel({ name: ' Ada ' });",
	'\t\tconst fallback = setupFallbackLabel();',
	'',
	"\t\texpect(getLabel({ name: name || fallback.name })).toBe('Ada');",
	'\t});',
	'',
	"\ttest('falls back when the name is empty', () => {",
	"\t\tconst { name } = setupLabel({ name: '' });",
	'\t\tconst fallback = setupFallbackLabel();',
	'',
	"\t\texpect(getLabel({ name: name || fallback.name })).toBe('Anonymous');",
	'\t});',
	'});',
].join('\n');

/** A test file whose own subject is a setup factory, calling it however the source spaces the call. */
const buildSubjectActSource = ({ call }: { call: string }) =>
	[
		"describe('setupWorkspace', () => {",
		"\ttest('names the workspace after its config', () => {",
		"\t\tconst config = setupConfig({ name: 'alpha' });",
		'',
		`\t\tconst workspace = ${call};`,
		'',
		"\t\texpect(workspace.name).toBe('alpha');",
		'\t});',
		'});',
	].join('\n');

describe('test-multiple-setups check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a test that calls more than one setup factory', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', twoSetupsSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-multiple-setups:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 7 }],
				detail: "'trims the name it is given' (line 2) calls more than one setup factory",
				guidance: 'Two setups means two tests. Heuristic — judge before acting.',
			},
		]);
	});

	test('leaves a test with a single arrangement factory alone', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', oneSetupSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([{ call: 'setupWorkspace({ config })' }, { call: 'setupWorkspace ({ config })' }])(
		'reads `$call` in setupWorkspace.unit.test.ts as the act, leaving its one arrangement factory alone',
		async ({ call }) => {
			const input = setupTestFileInput({ contents: [['src/feature/setupWorkspace.unit.test.ts', buildSubjectActSource({ call })]] });

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([]);
		},
	);

	test('names every over-arranged test of one file in a single finding', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', twoOverArrangedSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-multiple-setups:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 7 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 9, endLine: 14 },
				],
				detail: "'trims the name it is given' (line 2), 'falls back when the name is empty' (line 9) calls more than one setup factory",
				guidance: 'Two setups means two tests. Heuristic — judge before acting.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
