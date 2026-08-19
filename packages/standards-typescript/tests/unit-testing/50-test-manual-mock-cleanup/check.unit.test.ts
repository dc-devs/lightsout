import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const path = 'src/feature/getLabel.unit.test.ts';

/** A suite whose named hook runs the statement given — the hook runs from line 2 to line 4. */
const buildHookSource = ({ hook, statement }: { hook: string; statement: string }) =>
	["describe('subject', () => {", `\t${hook}(() => {`, `\t\t${statement}`, '\t});', '});'].join('\n');

/** The package's own fallback: the same reset, at the top of a factory rather than in a hook. */
const factoryResetSource = [
	'const setupCurrency = () => {',
	'\tmockGetCurrency.mockReset();',
	"\tmockGetCurrency.mockReturnValue('GBP');",
	'',
	"\treturn { currency: 'GBP' };",
	'};',
].join('\n');

describe('test-manual-mock-cleanup check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a beforeEach that clears mocks by hand, naming the line it opens on', async () => {
		const input = setupTestFileInput({ contents: [[path, buildHookSource({ hook: 'beforeEach', statement: 'jest.clearAllMocks();' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-manual-mock-cleanup:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 4 }],
				detail: 'beforeEach at line 2 clears mocks by hand',
				guidance: "Mock cleanup belongs in the package's Jest config (`clearMocks`, `restoreMocks`), not in a per-file hook.",
			},
		]);
	});

	test.each([
		{ statement: 'jest.resetAllMocks();' },
		{ statement: 'jest.restoreAllMocks();' },
		{ statement: 'mockGetTimezone.mockClear();' },
		{ statement: 'mockGetTimezone.mockReset();' },
	])('reports `$statement` in a hook too', async ({ statement }) => {
		const input = setupTestFileInput({ contents: [[path, buildHookSource({ hook: 'beforeEach', statement })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.detail)).toStrictEqual(['beforeEach at line 2 clears mocks by hand']);
	});

	test.each([
		{ hook: 'afterEach', detail: 'afterEach at line 2 clears mocks by hand' },
		{ hook: 'beforeAll', detail: 'beforeAll at line 2 clears mocks by hand' },
		{ hook: 'afterAll', detail: 'afterAll at line 2 clears mocks by hand' },
	])('reports a $hook clearing mocks as well — this rule reads all four hooks', async ({ hook, detail }) => {
		const input = setupTestFileInput({ contents: [[path, buildHookSource({ hook, statement: 'jest.clearAllMocks();' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.detail)).toStrictEqual([detail]);
	});

	test('leaves a reset at the top of a setup factory alone — that is the fallback the prose recommends', async () => {
		const input = setupTestFileInput({ contents: [[path, factoryResetSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
