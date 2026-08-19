import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('path-test-in-tests-folder check', () => {
	test('asks for the file list alone, since where a test sits is read from its path', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a unit test filed away from its subject, naming the folder it was filed into', async () => {
		const input = setupFileListInput({ source: ['src/feature/getLabel.ts'], tests: ['src/feature/tests/getLabel.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-test-in-tests-folder:src/feature/tests/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/tests/getLabel.unit.test.ts' }],
				detail: 'a unit test in src/feature/tests',
				guidance: 'Unit tests are co-located with the file they test — move it beside its subject rather than into a separate directory.',
			},
		]);
	});

	test.each([{ directory: '__tests__' }, { directory: 'tests' }, { directory: 'test' }])(
		'names $directory among the folder names it refuses, restated here so one dropped from the list stops enforcing loudly',
		async ({ directory }) => {
			const input = setupFileListInput({ source: ['src/feature/getLabel.ts'], tests: [`src/feature/${directory}/getLabel.unit.test.ts`] });

			const findings = await check.run({ input, settings: {} });

			expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([`path-test-in-tests-folder:src/feature/${directory}/getLabel.unit.test.ts`]);
		},
	);

	test('objects to a refused folder anywhere above the test, not only the one directly holding it', async () => {
		const input = setupFileListInput({ source: ['src/feature/getLabel.ts'], tests: ['src/tests/feature/nested/getLabel.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(['a unit test in src/tests/feature/nested']);
	});

	test('leaves a test sitting beside its subject alone — that is the placement the rule asks for', async () => {
		const input = setupFileListInput({ source: ['src/feature/getLabel.ts'], tests: ['src/feature/getLabel.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test("leaves a package's own tests/ tree alone, since outside src/ those names are the sanctioned test-support locations", async () => {
		const input = setupFileListInput({
			source: ['src/feature/getLabel.ts'],
			tests: ['tests/e2e/runPipeline.e2e.test.ts', 'test/fixtures/buildRepo.ts', '__tests__/legacy/getLabel.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each misplaced test on its own, so one separate directory cannot hide another', async () => {
		const input = setupFileListInput({
			source: ['src/a/getA.ts', 'src/b/getB.ts'],
			tests: ['src/a/tests/getA.unit.test.ts', 'src/b/getB.unit.test.ts', 'src/b/__tests__/getB.other.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ files }) => files[0]?.path)).toStrictEqual(['src/a/tests/getA.unit.test.ts', 'src/b/__tests__/getB.other.unit.test.ts']);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
