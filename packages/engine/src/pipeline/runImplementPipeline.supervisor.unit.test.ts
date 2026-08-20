import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// The supervisor consult on the red-gate exception path: cheap retries first,
// then escalate with a diagnosis, or heal the run with guided retry.

test('verify failure: cheap retries, then supervisor escalate with diagnosis', async () => {
	// the test gate is green until implement drops BROKEN; fixes never remove it.
	const dir = setupConsumerRepo({ scripts: { test: 'test ! -f BROKEN' } });
	const counts: Record<string, number> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			counts[role] = (counts[role] ?? 0) + 1;

			if (role === 'supervisor') {
				return { text: verdict({ decision: 'escalate', diagnosis: 'DIAGNOSIS-SENTINEL' }), exitCode: 0 };
			}

			if (role === 'fix') {
				// fix re-invocation carries changed files
				expect(prompt.includes('# Previously changed files')).toBeTruthy();

				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
			writeFileSync(join(dir, 'BROKEN'), 'x');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	expect(result.error ?? '').toMatch(/DIAGNOSIS-SENTINEL/);
	// exactly two cheap fix retries
	expect(counts.fix).toBe(2);
	// supervisor consulted exactly once
	expect(counts.supervisor).toBe(1);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(3);

	const failed = readCommandLog(dir, result.manifest.runId).find((entry) => entry.kind === 'test' && entry.exitCode !== 0);

	// failing command logged
	expect(failed).toBeTruthy();
	// failure carries an output tail
	expect(typeof failed?.outputTail).toBe('string');
});

test('supervisor retry-with-guidance heals the run', async () => {
	const dir = setupConsumerRepo({ scripts: { test: 'test ! -f BROKEN' } });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'supervisor') {
				return { text: verdict({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' }), exitCode: 0 };
			}

			if (role === 'fix') {
				if (prompt.includes('Supervisor guidance')) {
					unlinkSync(join(dir, 'BROKEN'));
				}

				return { text: report(), exitCode: 0 };
			}

			if (role === 'implement') {
				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
				writeFileSync(join(dir, 'BROKEN'), 'x');

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(4);
});
