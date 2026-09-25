import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const guidance = 'Every import names the file that declares it, so a folder index lists names nothing reads — delete it.';

/** Each path the run judges, with a one-line re-export as its text — only the manifests' text matters to this rule. */
const setupRepo = ({ paths, manifests = [] }: { paths: string[]; manifests?: Array<[string, unknown]> }) =>
	setupFileTextInput({
		contents: [
			...paths.map((path): [string, string] => [path, "export { a } from './a';"]),
			...manifests.map(([path, data]): [string, string] => [path, JSON.stringify(data)]),
		],
		files: paths,
	});

describe('folder-index-file check', () => {
	test('reports an index file in a folder', async () => {
		const input = setupRepo({ paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'folder-index-file:src/ingestion/index.ts',
				files: [{ path: 'src/ingestion/index.ts' }],
				detail: 'an index file in src/ingestion, which is no package entry',
				guidance,
			},
		]);
	});

	test('reports every spelling of an index file, under common/ as anywhere else', async () => {
		const input = setupRepo({ paths: ['src/billing/index.js', 'src/billing/common/utils/index.tsx', 'src/billing/charge.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'folder-index-file:src/billing/index.js',
			'folder-index-file:src/billing/common/utils/index.tsx',
		]);
	});

	test('accepts the entry at a package’s root or its src/, in a repo with no manifest', async () => {
		const input = setupRepo({ paths: ['index.ts', 'src/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts each workspace package’s entry, and a subpath entry its manifest names', async () => {
		const input = setupRepo({
			paths: ['packages/engine/src/index.ts', 'packages/engine/src/contracts/index.ts', 'packages/engine/src/queue/index.ts', 'packages/web/index.ts'],
			manifests: [
				['packages/engine/package.json', { exports: { '.': './dist/index.js', './contracts': './src/contracts/index.ts' } }],
				['packages/web/package.json', { private: true }],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['folder-index-file:packages/engine/src/queue/index.ts']);
	});

	test('reports a src/index.ts that belongs to no package, since only a package has an entry', async () => {
		const input = setupRepo({ paths: ['tools/src/index.ts'], manifests: [['packages/web/package.json', {}]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['folder-index-file:tools/src/index.ts']);
	});

	test('leaves a route index file the framework loads alone', async () => {
		const input = setupRepo({
			paths: ['src/routes/index.tsx', 'src/routes/runs/index.tsx'],
			manifests: [['package.json', { dependencies: { '@tanstack/react-router': '1.0.0' } }]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('answers nothing for an input of another kind', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
