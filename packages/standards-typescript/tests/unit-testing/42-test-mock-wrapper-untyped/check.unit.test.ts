import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const path = 'src/feature/getLabel.unit.test.ts';

/** A factory whose forward is written the way the line given writes it — the `jest.mock` call runs from line 3 to line 5. */
const buildFactorySource = ({ forward }: { forward: string }) =>
	["import { expect, jest, test } from '@jest/globals';", '', "jest.mock('@/orders/saveOrder', () => ({", `\t${forward}`, '}));'].join('\n');

/** The assertion that proves the mocked function takes arguments at all. */
const callAssertion = ['', "test('forwards the order id', () => {", "\texpect(mockSaveOrder).toHaveBeenCalledWith({ id: 'a' });", '});'].join('\n');

/** One factory earning both verdicts at once: a discarding wrapper beside an argument-dropping forward. */
const bothReasonsSource = [
	"import { expect, jest, test } from '@jest/globals';",
	'',
	"jest.mock('@/orders/orders', () => ({",
	'\tsaveOrder: () => mockSaveOrder(),',
	'\tloadOrder: (...args: unknown[]) => mockLoadOrder(args[0]),',
	'}));',
	callAssertion,
].join('\n');

/** Two discarding factories in one file, opening on lines 3 and 7. */
const twoFactoriesSource = [
	"import { jest } from '@jest/globals';",
	'',
	"jest.mock('@/orders/saveOrder', () => ({",
	'\tsaveOrder: (...args: unknown[]) => mockSaveOrder(args[0]),',
	'}));',
	'',
	"jest.mock('@/orders/loadOrder', () => ({",
	'\tloadOrder: (...args: unknown[]) => mockLoadOrder(args[0]),',
	'}));',
].join('\n');

describe('test-mock-wrapper-untyped check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a wrapper typed to discard its arguments', async () => {
		const input = setupTestFileInput({
			contents: [[path, buildFactorySource({ forward: 'saveOrder: (...args: unknown[]) => mockSaveOrder(args[0]),' })]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mock-wrapper-untyped:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 5 }],
				detail: 'a `(...args: unknown[])` wrapper (line 3)',
				guidance: 'Type the factory wrapper to the real parameters — a discarded argument makes `toHaveBeenCalledWith` fail on a call that was correct.',
			},
		]);
	});

	test('reports a zero-argument forward once the file asserts the call took arguments', async () => {
		const input = setupTestFileInput({
			contents: [[path, `${buildFactorySource({ forward: 'saveOrder: () => mockSaveOrder(),' })}\n${callAssertion}`]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.detail)).toStrictEqual(["'saveOrder' forwards no arguments to mockSaveOrder (line 3)"]);
	});

	test('leaves a zero-argument forward alone when nothing in the file claims the call took arguments', async () => {
		const input = setupTestFileInput({ contents: [[path, buildFactorySource({ forward: 'saveOrder: () => mockSaveOrder(),' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a wrapper typed to the real parameters alone', async () => {
		const input = setupTestFileInput({
			contents: [[path, `${buildFactorySource({ forward: 'saveOrder: (params: { id: string }) => mockSaveOrder(params),' })}\n${callAssertion}`]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('states both verdicts against one factory that earns them both', async () => {
		const input = setupTestFileInput({ contents: [[path, bothReasonsSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.detail)).toStrictEqual([
			"a `(...args: unknown[])` wrapper; 'saveOrder' forwards no arguments to mockSaveOrder (line 3)",
		]);
	});

	test('names every offending factory of one file in a single finding', async () => {
		const input = setupTestFileInput({ contents: [[path, twoFactoriesSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mock-wrapper-untyped:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 5 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 7, endLine: 9 },
				],
				detail: 'a `(...args: unknown[])` wrapper (line 3), a `(...args: unknown[])` wrapper (line 7)',
				guidance: 'Type the factory wrapper to the real parameters — a discarded argument makes `toHaveBeenCalledWith` fail on a call that was correct.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
