import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readImportAliases } from '#src/common/workspace/readImportAliases.ts';

const setupRepo = ({ files }: { files: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-imports-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), content);
	}

	return cwd;
};

describe('readImportAliases', () => {
	test('reads the imports of every manifest at or above the files, keyed by the directory holding it', async () => {
		const cwd = setupRepo({
			files: {
				'package.json': JSON.stringify({ name: 'root' }),
				'packages/engine/package.json': JSON.stringify({ imports: { '#src/*': './src/*', '#tests/*': './tests/*' } }),
				'packages/engine/src/main.ts': '',
				'packages/web/package.json': JSON.stringify({ imports: { '#config': { import: './src/config.ts', require: './src/config.cjs' } } }),
				'packages/web/src/app.ts': '',
			},
		});

		const aliases = await readImportAliases({ cwd, files: ['packages/engine/src/main.ts', 'packages/web/src/app.ts'] });

		expect(aliases).toStrictEqual(
			new Map([
				['.', []],
				[
					'packages/engine',
					[
						{ pattern: '#src/*', target: './src/*' },
						{ pattern: '#tests/*', target: './tests/*' },
					],
				],
				['packages/web', [{ pattern: '#config', target: './src/config.ts' }]],
			]),
		);
	});

	test('keeps a condition map’s default branch, and leaves out a target it cannot name a file from', async () => {
		const cwd = setupRepo({
			files: {
				'package.json': JSON.stringify({ imports: { '#a': { default: './a.ts' }, '#b': ['./b.ts', './b.js'], '#c': { node: { import: './c.ts' } } } }),
				'src/main.ts': '',
			},
		});

		const aliases = await readImportAliases({ cwd, files: ['src/main.ts'] });

		expect(aliases).toStrictEqual(new Map([['.', [{ pattern: '#a', target: './a.ts' }]]]));
	});

	test('a manifest that cannot be read as JSON declares no aliases but still marks its package', async () => {
		const cwd = setupRepo({ files: { 'package.json': 'not json', 'src/main.ts': '' } });

		const aliases = await readImportAliases({ cwd, files: ['src/main.ts'] });

		expect(aliases).toStrictEqual(new Map([['.', []]]));
	});

	test('a repo with no manifest anywhere has no packages to resolve through', async () => {
		const cwd = setupRepo({ files: { 'src/main.ts': '' } });

		const aliases = await readImportAliases({ cwd, files: ['src/main.ts'] });

		expect(aliases).toStrictEqual(new Map());
	});
});
