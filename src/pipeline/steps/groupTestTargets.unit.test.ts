import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

test('write-tests fan-out: files that import each other share ONE writer; unrelated files stay parallel', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });

	const writerPrompts: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				writerPrompts.push(prompt);

				const testFile = `test/writer-${writerPrompts.length}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// Implement: a boundary importing an internal, plus one unrelated file.
			writeFileSync(join(dir, 'src/helper.ts'), 'export const helper = (n: number) => n + 1;\n');
			writeFileSync(join(dir, 'src/feature.ts'), `import { helper } from './helper';\n\nexport const feature = (n: number) => helper(n) * 2;\n`);
			writeFileSync(join(dir, 'src/other.ts'), 'export const other = () => 3;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.ts', summary: 'boundary' },
						{ path: 'src/helper.ts', summary: 'internal' },
						{ path: 'src/other.ts', summary: 'unrelated' },
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
	assert.equal(writerPrompts.length, 2, 'two import components — two writers, not three');

	const grouped = writerPrompts.find((prompt) => prompt.includes('src/feature.ts'));
	const solo = writerPrompts.find((prompt) => prompt.includes('src/other.ts'));

	assert.ok(grouped && grouped.includes('src/helper.ts'), 'boundary and its internal share one writer');
	assert.ok(grouped?.includes('These files changed together'), 'multi-file group carries the boundary-coverage instruction');
	assert.ok(solo && !solo.includes('src/feature.ts') && !solo.includes('src/helper.ts'), 'unrelated file gets its own writer');
	assert.ok(!solo.includes('These files changed together'), 'single-file group carries no group note');
	assert.ok(
		progress.some((line) => line.includes('2 group(s) across 3 file(s) (import-graph)')),
		`grouping narrated — got:\n${progress.join('\n')}`,
	);
});
