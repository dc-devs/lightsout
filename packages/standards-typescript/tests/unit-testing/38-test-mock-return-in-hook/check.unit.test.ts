import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const path = 'src/feature/getLabel.unit.test.ts';

/** A suite whose named hook calls the named setter on a spy — the hook runs from line 2 to line 4. */
const buildHookSource = ({ hook, setter }: { hook: string; setter: string }) =>
	["describe('subject', () => {", `\t${hook}(() => {`, `\t\tmockGetProfile.${setter}('p.png');`, '\t});', '});'].join('\n');

describe('test-mock-return-in-hook check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a beforeEach that sets a return value, naming the line it opens on', async () => {
		const input = setupTestFileInput({ contents: [[path, buildHookSource({ hook: 'beforeEach', setter: 'mockReturnValue' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mock-return-in-hook:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 4 }],
				detail: 'beforeEach at line 2 sets a mock return value',
				guidance: 'Set mock return values in the `setup()` factory, so each test states its own arrangement.',
			},
		]);
	});

	test.each([{ setter: 'mockResolvedValue' }, { setter: 'mockRejectedValue' }, { setter: 'mockImplementation' }])(
		'reports a beforeEach calling $setter too',
		async ({ setter }) => {
			const input = setupTestFileInput({ contents: [[path, buildHookSource({ hook: 'beforeEach', setter })]] });

			const findings = await check.run({ input, settings: {} });

			expect(findings.map((finding) => finding.detail)).toStrictEqual(['beforeEach at line 2 sets a mock return value']);
		},
	);

	test('leaves a one-call override alone — the rule names the four setters and not their Once variants', async () => {
		const input = setupTestFileInput({ contents: [[path, buildHookSource({ hook: 'beforeEach', setter: 'mockReturnValueOnce' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([{ hook: 'afterEach' }, { hook: 'beforeAll' }, { hook: 'afterAll' }])(
		'leaves a return value set in a $hook alone — the rule names beforeEach and nothing else',
		async ({ hook }) => {
			const input = setupTestFileInput({ contents: [[path, buildHookSource({ hook, setter: 'mockReturnValue' })]] });

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([]);
		},
	);

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
