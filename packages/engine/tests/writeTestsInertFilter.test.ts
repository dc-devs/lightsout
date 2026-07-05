import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { loadConfig, runImplementPipeline } from '../src/index';
import { report } from './helpers/report';
import { roleOf } from './helpers/roleOf';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

/** Make the engine repo's own typescript resolvable from the temp consumer repo (resolveConsumerTypescript walks its node_modules). */
const linkTypescript = (dir: string) => {
	const typescriptDir = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));

	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(realpathSync(typescriptDir), join(dir, 'node_modules', 'typescript'), 'dir');
};

test('write-tests fan-out: inert files (barrel, type-only) spawn no writer; behavioral files still do', async () => {
	const dir = setupConsumerRepo();

	linkTypescript(dir);

	const writerTargets: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				writerTargets.push(prompt.match(/- (\S+)/)?.[1] ?? 'unknown');
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// Implement: one behavioral module, one barrel, one type-only file.
			writeFileSync(join(dir, 'src/feature.ts'), 'export const feature = (n: number) => n * 2;\n');
			writeFileSync(join(dir, 'src/barrel.ts'), `export { feature } from './feature';\n`);
			writeFileSync(join(dir, 'src/types.ts'), 'export interface Feature {\n\tvalue: number;\n}\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.ts', summary: 'feature' },
						{ path: 'src/barrel.ts', summary: 'barrel' },
						{ path: 'src/types.ts', summary: 'types' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	assert.equal(result.ok, true, result.error);
	assert.deepEqual(writerTargets, ['src/feature.ts'], 'only the behavioral file earned a writer');
	assert.ok(
		progress.some((line) => line.includes('2 inert file(s) skipped') && line.includes('src/barrel.ts') && line.includes('src/types.ts')),
		`inert skip narrated with the file list — got:\n${progress.join('\n')}`,
	);
	assert.ok(
		progress.some((line) => line.includes('step write-tests') && line.includes('1 file(s)')),
		'fan-out count reflects the filtered set',
	);
});
