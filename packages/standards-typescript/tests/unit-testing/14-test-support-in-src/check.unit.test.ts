import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('test-support-in-src check', () => {
	test('asks for the file list alone, since a folder is judged by its name and its place', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a shared fixtures folder living under src/, naming the folder rather than its files', async () => {
		const input = setupFileListInput({ source: ['src/feature/getLabel.ts', 'src/feature/fixtures/sampleLabel.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-support-in-src:src/feature/fixtures',
				files: [{ path: 'src/feature/fixtures' }],
				detail: "test-support folder 'fixtures' under src/",
				guidance:
					"Shared helpers, mocks and fixtures live in the package's test-support directories outside `src/` — under `src/` they read as production source to scanners and humans alike. A `__mocks__/` folder beside the module it doubles is the one exception.",
			},
		]);
	});

	test.each([{ folder: 'fixtures' }, { folder: 'mocks' }, { folder: 'testUtils' }, { folder: 'test-utils' }])(
		'names $folder among the test-support folders it places outside src/, restated here so one dropped from the list stops enforcing loudly',
		async ({ folder }) => {
			const input = setupFileListInput({ source: [`src/feature/${folder}/sampleLabel.ts`] });

			const findings = await check.run({ input, settings: {} });

			expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([`test-support-in-src:src/feature/${folder}`]);
		},
	);

	test('leaves a __mocks__ beside its module alone, which the same prose allows, and helpers, which another rule owns', async () => {
		const input = setupFileListInput({ source: ['src/feature/__mocks__/getLabel.ts', 'src/feature/helpers/buildLabel.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test("leaves the same folder names alone outside src/, where they are the package's sanctioned test-support locations", async () => {
		const input = setupFileListInput({ source: ['tests/fixtures/sampleLabel.ts', 'test/mocks/getLabel.ts', 'testUtils/buildRepo.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each misplaced folder once however many files it holds, in path order', async () => {
		const input = setupFileListInput({
			source: ['src/b/mocks/one.ts', 'src/b/mocks/two.ts', 'src/a/fixtures/three.ts', 'src/a/fixtures/nested/four.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['test-support-in-src:src/a/fixtures', 'test-support-in-src:src/b/mocks']);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
