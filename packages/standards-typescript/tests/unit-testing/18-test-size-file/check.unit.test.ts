import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const setupLines = ({ count }: { count: number }) => Array.from({ length: count }, (_, index) => `test('case ${index}', () => {});`).join('\n');

describe('test-size-file check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a test file past the cap, stating the count and the cap it broke', async () => {
		const input = setupTestFileInput({ contents: [['src/doctor/runDoctor.unit.test.ts', setupLines({ count: 6 })]] });

		const findings = await check.run({ input, settings: { testFile: 5 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-size-file:src/doctor/runDoctor.unit.test.ts',
				files: [{ path: 'src/doctor/runDoctor.unit.test.ts' }],
				detail: '6 lines (cap ~5)',
				guidance:
					'A test file this long is a module asking for promotion — give each internal unit a direct test beside it, export the unit from the module’s barrel, and leave the boundary file its orchestration.',
			},
		]);
	});

	test('leaves a test file at the cap alone — the cap is a ceiling, not a target to stay clear of', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/renderGreeting.unit.test.ts', setupLines({ count: 5 })]] });

		const findings = await check.run({ input, settings: { testFile: 5 } });

		expect(findings).toStrictEqual([]);
	});

	test('reports each oversized file on its own, so one monster cannot hide another', async () => {
		const input = setupTestFileInput({
			contents: [
				['src/a/runA.unit.test.ts', setupLines({ count: 7 })],
				['src/b/runB.unit.test.ts', setupLines({ count: 3 })],
				['src/c/runC.unit.test.ts', setupLines({ count: 9 })],
			],
		});

		const findings = await check.run({ input, settings: { testFile: 5 } });

		expect(findings.map((finding) => finding.files[0]?.path)).toStrictEqual(['src/a/runA.unit.test.ts', 'src/c/runC.unit.test.ts']);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: { testFile: 5 } });

		expect(findings).toStrictEqual([]);
	});
});
