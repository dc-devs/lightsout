import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const path = 'src/feature/getLabel.unit.test.ts';

/** A test file whose only content is the declaration given, sitting on line 3. */
const buildSpySource = ({ declaration }: { declaration: string }) => ["import { jest } from '@jest/globals';", '', declaration].join('\n');

/** A stub cast to satisfy a library's own result type, with the cast trailing the spy by three lines. */
const buildStubSource = ({ cast }: { cast: string }) =>
	["import { jest } from '@jest/globals';", '', 'const mockQueryResult = {', "\tdata: 'p.png',", '\trefetch: jest.fn(),', `} ${cast};`].join('\n');

/** A file whose sample data quotes an untyped spy — a mention, not a use. */
const quotedSampleSource = [
	"const sampleLine = 'const getAvatar = jest.fn();';",
	'',
	"describe('subject', () => {",
	"\ttest('carries its sample line untouched', () => {",
	"\t\texpect(sampleLine).toContain('getAvatar');",
	'\t});',
	'});',
].join('\n');

/** Two untyped spies, on lines 3 and 4. */
const twoUntypedSource = ["import { jest } from '@jest/globals';", '', 'const mockGetLocale = jest.fn();', 'const mockGetRegion = jest.fn();'].join('\n');

describe('test-mock-untyped check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a spy declared with no generic, naming the line', async () => {
		const input = setupTestFileInput({ contents: [[path, buildSpySource({ declaration: 'const mockGetLocale = jest.fn();' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mock-untyped:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 3 }],
				detail: 'jest.fn() with no generic at line(s) 3',
				guidance: 'Type every `jest.fn()` to the real signature — read the source first, and include the Promise wrapper for an async one.',
			},
		]);
	});

	test('leaves a spy typed to its real signature alone', async () => {
		const input = setupTestFileInput({ contents: [[path, buildSpySource({ declaration: 'const mockGetLocale = jest.fn<() => string>();' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([{ cast: 'as unknown as UseQueryResult<string, Error>' }, { cast: 'as Record<string, unknown>' }])(
		'leaves a stub the statement casts with `$cast` alone',
		async ({ cast }) => {
			const input = setupTestFileInput({ contents: [[path, buildStubSource({ cast })]] });

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([]);
		},
	);

	test('leaves a quoted sample line alone — the rule reads what a file does, not what it quotes', async () => {
		const input = setupTestFileInput({ contents: [[path, quotedSampleSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names every untyped spy of one file in a single finding', async () => {
		const input = setupTestFileInput({ contents: [[path, twoUntypedSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mock-untyped:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 3 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 4, endLine: 4 },
				],
				detail: 'jest.fn() with no generic at line(s) 3, 4',
				guidance: 'Type every `jest.fn()` to the real signature — read the source first, and include the Promise wrapper for an async one.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
