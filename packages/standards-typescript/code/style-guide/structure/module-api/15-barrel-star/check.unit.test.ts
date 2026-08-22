import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A repo as the engine hands it to a file-text rule: every path in scope, with its text. */
const setupFileTextInput = ({ contents }: { contents: Array<[string, string]> }): StandardsCheckInput => {
	const files = contents.map(([path]) => path);

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files,
		tests: [],
		files,
		referenceFiles: [],
		contents: new Map(contents),
		standardsPacks: [],
	};
};

describe('barrel-star check', () => {
	test('asks for file text, since the verdict is in the barrel’s own re-export lines', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a module barrel that re-exports with `export *`', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export * from './renderGreeting';"],
				['src/feature/renderGreeting.ts', "export const renderGreeting = (): string => 'hello';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-star:src/feature/index.ts',
				files: [{ path: 'src/feature/index.ts' }],
				detail: "'./renderGreeting' re-exported with `export *`",
				guidance: 'A barrel is a module’s public API — list named re-exports instead.',
			},
		]);
	});

	test('names every starred specifier in one finding, the namespaced form included', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', ["export * from './renderGreeting';", "export * as builders from './buildGreeting';"].join('\n')],
				['src/feature/renderGreeting.ts', "export const renderGreeting = (): string => 'hello';"],
				['src/feature/buildGreeting.ts', "export const buildGreeting = (): string => 'hello';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-star:src/feature/index.ts',
				files: [{ path: 'src/feature/index.ts' }],
				detail: "'./renderGreeting', './buildGreeting' re-exported with `export *`",
				guidance: 'A barrel is a module’s public API — list named re-exports instead.',
			},
		]);
	});

	test('leaves a barrel of named re-exports alone — that is the contract the rule asks for', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting';"],
				['src/feature/renderGreeting.ts', "export const renderGreeting = (): string => 'hello';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('spares a package’s src root barrel, whose consumers sit outside this repo', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/index.ts', "export * from './bootstrap';"],
				['src/bootstrap.ts', 'export const bootstrap = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('spares a barrel under common/, whose very existence is another rule’s objection', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/billing/common/utils/index.ts', "export * from './formatRate';"],
				['src/billing/common/utils/formatRate.ts', "export const formatRate = (): string => '1';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
