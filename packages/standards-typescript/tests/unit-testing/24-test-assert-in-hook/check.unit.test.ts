import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A suite whose named hook holds one assertion — the hook opens on line 2 and closes on line 4. */
const buildAssertingHookSource = ({ hook }: { hook: string }) =>
	["describe('subject', () => {", `\t${hook}(() => {`, '\t\texpect(1 + 1).toBe(2);', '\t});', '});'].join('\n');

/** A `beforeEach` that only arranges: it sets a value up and claims nothing. */
const arrangingHookSource = ["describe('subject', () => {", '\tbeforeEach(() => {', "\t\tmockGetProfile.mockReturnValue('p.png');", '\t});', '});'].join('\n');

/** Two asserting `beforeEach` hooks in one suite, opening on lines 2 and 6. */
const twoAssertingHooksSource = [
	"describe('subject', () => {",
	'\tbeforeEach(() => {',
	'\t\texpect(1 + 1).toBe(2);',
	'\t});',
	'',
	'\tbeforeEach(() => {',
	'\t\texpect(2 + 2).toBe(4);',
	'\t});',
	'});',
].join('\n');

describe('test-assert-in-hook check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a beforeEach that asserts, naming the line it opens on', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', buildAssertingHookSource({ hook: 'beforeEach' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-assert-in-hook:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 4 }],
				detail: 'beforeEach at line 2 asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			},
		]);
	});

	test.each([{ hook: 'afterEach' }, { hook: 'beforeAll' }, { hook: 'afterAll' }])(
		'leaves an assertion in a $hook alone — the rule names beforeEach and nothing else',
		async ({ hook }) => {
			const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', buildAssertingHookSource({ hook })]] });

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([]);
		},
	);

	test('leaves a beforeEach that only arranges alone', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', arrangingHookSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names every asserting beforeEach of one file in a single finding', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', twoAssertingHooksSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-assert-in-hook:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 4 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 6, endLine: 8 },
				],
				detail: 'beforeEach at line 2, beforeEach at line 6 asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
