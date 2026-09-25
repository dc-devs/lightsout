import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

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
				guidance: 'An index file is a package’s public API — list named re-exports instead.',
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
				guidance: 'An index file is a package’s public API — list named re-exports instead.',
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

	test('reports a package’s entry too, since other packages build against what it lists', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/index.ts', "export * from './bootstrap';"],
				['src/bootstrap.ts', 'export const bootstrap = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['barrel-star:src/index.ts']);
	});

	test('spares a route index file the framework loads, which is no index file', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/routes/index.tsx', "export * from './home';"],
				['package.json', JSON.stringify({ dependencies: { '@tanstack/react-router': '1.0.0' } })],
			],
			files: ['src/routes/index.tsx'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a JavaScript-spelled barrel too — these rules judge paths, so a repo with no TypeScript is judged at full strength', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.js', "export * from './ingestRecords.js';"],
				['src/ingestion/ingestRecords.js', 'export const ingestRecords = () => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-star:src/ingestion/index.js',
				files: [{ path: 'src/ingestion/index.js' }],
				detail: "'./ingestRecords.js' re-exported with `export *`",
				guidance: 'An index file is a package’s public API — list named re-exports instead.',
			},
		]);
	});

	test('reports the remaining source dialects on the same footing — an `.mjs` and a `.jsx` barrel are barrels', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/reporting/index.mjs', "export * from './collectRows.mjs';"],
				['src/reporting/collectRows.mjs', 'export const collectRows = () => [];'],
				['src/widgets/index.jsx', "export * from './Widget.jsx';"],
				['src/widgets/Widget.jsx', 'export const Widget = () => null;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-star:src/reporting/index.mjs',
				files: [{ path: 'src/reporting/index.mjs' }],
				detail: "'./collectRows.mjs' re-exported with `export *`",
				guidance: 'An index file is a package’s public API — list named re-exports instead.',
			},
			{
				siteKey: 'barrel-star:src/widgets/index.jsx',
				files: [{ path: 'src/widgets/index.jsx' }],
				detail: "'./Widget.jsx' re-exported with `export *`",
				guidance: 'An index file is a package’s public API — list named re-exports instead.',
			},
		]);
	});

	test('spares a file whose name merely starts with index — the barrel question is the whole name, so widening the dialects did not widen it to near-misses', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.helpers.ts', "export * from './renderGreeting';"],
				['src/feature/renderGreeting.ts', "export const renderGreeting = (): string => 'hello';"],
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
