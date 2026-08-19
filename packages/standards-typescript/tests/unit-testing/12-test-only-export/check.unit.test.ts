import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('test-only-export check', () => {
	test('asks for file text, since the verdict counts who mentions the name across the repo', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports an export its own test is the only thing reaching', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting';"],
				['src/feature/renderGreeting.ts', 'export const renderGreeting = ({ name }: { name: string }): string => `<p>${name}</p>`;'],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
				['src/feature/buildGreeting.unit.test.ts', "import { buildGreeting } from './buildGreeting';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-only-export:src/feature/buildGreeting.ts',
				files: [{ path: 'src/feature/buildGreeting.ts' }],
				detail: "'buildGreeting' is referenced only by tests",
				guidance: 'A production-dead candidate: only its own tests keep it alive.',
			},
		]);
	});

	test('leaves an export a barrel publishes alongside its test alone — that pair is deliberate public API', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export { buildGreeting } from './buildGreeting';"],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
				['src/feature/buildGreeting.unit.test.ts', "import { buildGreeting } from './buildGreeting';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an export nothing mentions at all alone — that is the dead-export verdict, not this one', async () => {
		const input = setupFileTextInput({
			contents: [['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an export production code still calls alone, however many tests also reach it', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/renderGreeting.ts', "import { buildGreeting } from './buildGreeting';\nexport const renderGreeting = (): string => buildGreeting();"],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
				['src/feature/buildGreeting.unit.test.ts', "import { buildGreeting } from './buildGreeting';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('gathers every test-only export of one file into a single finding that names each', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/feature/greetings.ts',
					'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;\nexport const buildFarewell = ({ name }: { name: string }): string => `Bye, ${name}.`;',
				],
				['src/feature/greetings.unit.test.ts', "import { buildGreeting, buildFarewell } from './greetings';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-only-export:src/feature/greetings.ts',
				files: [{ path: 'src/feature/greetings.ts' }],
				detail: "'buildGreeting', 'buildFarewell' are referenced only by tests",
				guidance: 'A production-dead candidate: only its own tests keep it alive.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
