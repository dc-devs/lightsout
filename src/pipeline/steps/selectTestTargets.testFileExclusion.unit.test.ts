import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

test('write-tests fan-out: files under __tests__/ are test files, never writer targets', async () => {
	const dir = setupConsumerRepo();
	const writerTargets: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

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

	expect(result.ok).toBe(true);
	// the __tests__/ helper must not earn a test writer
	expect(writerTargets).toStrictEqual(['src/feature.ts']);
});
