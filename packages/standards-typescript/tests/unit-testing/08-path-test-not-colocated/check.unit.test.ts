import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('path-test-not-colocated check', () => {
	test('asks for the file list alone, since the subject is looked for by path in the test’s own folder', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a test whose first name segment names no source file beside it', async () => {
		const input = setupFileListInput({ source: ['src/feature/getLabel.ts'], tests: ['src/feature/labelling.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-test-not-colocated:src/feature/labelling.unit.test.ts',
				files: [{ path: 'src/feature/labelling.unit.test.ts' }],
				detail: "no source file named 'labelling' in src/feature",
				guidance:
					'The first name segment must name a real source file in the same folder; a scenario suite qualifies it as `<File>.<scenario>.unit.test.ts` with a camelCase qualifier.',
			},
		]);
	});

	test('leaves a test sitting beside the file it names alone', async () => {
		const input = setupFileListInput({ source: ['src/feature/getLabel.ts'], tests: ['src/feature/getLabel.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts a scenario suite, whose qualifier sits after the segment naming the subject', async () => {
		const input = setupFileListInput({
			source: ['src/pipeline/runPipeline.ts'],
			tests: ['src/pipeline/runPipeline.monorepo.unit.test.ts', 'src/pipeline/runPipeline.nested.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([{ extension: 'ts' }, { extension: 'tsx' }, { extension: 'js' }, { extension: 'jsx' }, { extension: 'mjs' }, { extension: 'cjs' }])(
		'accepts a subject written as .$extension, so a JavaScript repo is judged at full strength too',
		async ({ extension }) => {
			const input = setupFileListInput({ source: [`src/feature/getLabel.${extension}`], tests: ['src/feature/getLabel.unit.test.ts'] });

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([]);
		},
	);

	test('a file of that name in another folder does not count — co-location is about this folder', async () => {
		const input = setupFileListInput({ source: ['src/other/getLabel.ts'], tests: ['src/feature/getLabel.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["no source file named 'getLabel' in src/feature"]);
	});

	test("leaves a package's own tests/ tree alone, whose files name no subject beside them by design", async () => {
		const input = setupFileListInput({ source: ['src/feature/getLabel.ts'], tests: ['tests/integration/labelling.integration.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each orphaned test on its own, in the order the input lists them', async () => {
		const input = setupFileListInput({
			source: ['src/a/getA.ts', 'src/b/getB.ts'],
			tests: ['src/a/labelling.unit.test.ts', 'src/b/getB.unit.test.ts', 'src/b/rendering.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'path-test-not-colocated:src/a/labelling.unit.test.ts',
			'path-test-not-colocated:src/b/rendering.unit.test.ts',
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
