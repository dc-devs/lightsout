import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * A consumer repo whose implement step lands two unrelated source files — one
 * writer each, `src/alpha.js` first — and whose second writer hits the
 * harness rate limit after the first has already landed its test file.
 */
const setupParkedWriterRun = async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (roleOf(prompt) === 'write-tests') {
				if (prompt.includes('src/zeta.js')) {
					return { text: '', exitCode: 1, rateLimited: true };
				}

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/alpha.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/alpha.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/alpha.js', source: 'export const alpha = () => 1;\n' });
			writeSource({ dir, path: 'src/zeta.js', source: 'export const zeta = () => 2;\n' });

			return {
				text: report({
					changedFiles: [
						{ path: 'src/alpha.js', summary: 'alpha' },
						{ path: 'src/zeta.js', summary: 'zeta' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, config: await readConfig({ cwd: dir }) };
};

test('write-tests: a rate-limited writer parks the run, and the writers that already landed keep their work', async () => {
	const { dir, driver, config } = await setupParkedWriterRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	// the landed writer is persisted before the park is decided — a resumed run
	// knows what exists
	expect(result.manifest.steps.find((step) => step.id === 'write-tests')?.changedFiles).toStrictEqual(['test/alpha.test.js']);
	// and the run-wide changed-file truth carries it too
	expect(result.manifest.changedFiles.includes('test/alpha.test.js')).toBeTruthy();
	// the run stopped at write-tests
	expect(result.manifest.steps.find((step) => step.id === 'verify-tests')).toBe(undefined);
});
