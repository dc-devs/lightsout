import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const path = 'src/feature/getLabel.unit.test.ts';

/** A test file whose only content is the declaration given, sitting on line 3. */
const buildMockSource = ({ declaration }: { declaration: string }) => ["import { jest } from '@jest/globals';", '', declaration].join('\n');

/** Two module-scope spies, neither one prefixed, on lines 3 and 4. */
const twoUnprefixedSource = [
	"import { jest } from '@jest/globals';",
	'',
	'const getProfile = jest.fn<() => string>();',
	'const getGravatar = jest.fn<() => string>();',
].join('\n');

/** A spy built inside a factory, where hoisting cannot reach it. */
const factoryLocalSource = [
	"import { jest } from '@jest/globals';",
	'',
	'const setupProfile = () => {',
	'\tconst getGravatar = jest.fn<() => string>();',
	'',
	'\treturn { getGravatar };',
	'};',
].join('\n');

describe('test-mock-prefix check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a module-scope spy declared without the mock prefix', async () => {
		const input = setupTestFileInput({ contents: [[path, buildMockSource({ declaration: 'const getProfile = jest.fn<() => string>();' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mock-prefix:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 3 }],
				detail: "'getProfile' (line 3) declared at module scope without a 'mock' prefix",
				guidance: 'Jest hoists `jest.mock()` above module variables — only `mock`-prefixed names are reachable inside the factory.',
			},
		]);
	});

	test('leaves a prefixed declaration alone', async () => {
		const input = setupTestFileInput({ contents: [[path, buildMockSource({ declaration: 'const mockGetProfile = jest.fn<() => string>();' })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a spy built inside a factory alone — nothing hoists above a local', async () => {
		const input = setupTestFileInput({ contents: [[path, factoryLocalSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names every unprefixed declaration of one file in a single finding', async () => {
		const input = setupTestFileInput({ contents: [[path, twoUnprefixedSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-mock-prefix:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 3, endLine: 3 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 4, endLine: 4 },
				],
				detail: "'getProfile' (line 3), 'getGravatar' (line 4) declared at module scope without a 'mock' prefix",
				guidance: 'Jest hoists `jest.mock()` above module variables — only `mock`-prefixed names are reachable inside the factory.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
