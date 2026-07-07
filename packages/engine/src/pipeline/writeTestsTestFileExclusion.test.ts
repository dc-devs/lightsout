import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { loadConfig, runImplementPipeline } from '../index';
import { report } from '../../tests/helpers/report';
import { roleOf } from '../../tests/helpers/roleOf';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

test('write-tests fan-out: files under __tests__/ are test files, never writer targets', async () => {
	const dir = setupConsumerRepo();
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

			// Implement: one behavioral module plus a helper inside __tests__/ —
			// the divergence case: the old pipeline predicate missed dunder dirs
			// and spawned a writer to write tests for a test helper.
			writeFileSync(join(dir, 'src/feature.ts'), 'export const feature = (n: number) => n * 2;\n');
			mkdirSync(join(dir, 'src/__tests__'), { recursive: true });
			writeFileSync(join(dir, 'src/__tests__/feature.helper.ts'), 'export const stubFeature = () => 4;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.ts', summary: 'feature' },
						{ path: 'src/__tests__/feature.helper.ts', summary: 'test helper' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
	});

	assert.equal(result.ok, true, result.error);
	assert.deepEqual(writerTargets, ['src/feature.ts'], 'the __tests__/ helper must not earn a test writer');
});
