import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readRunManifest } from '#src/runState/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// Parks and resumes: a rate limit pauses resumable, and resume continues
// exactly where the manifest says the run stopped.

test('rate-limited harness parks the run with resume instructions', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
});

test('resume skips passed steps and continues attempt counts', async () => {
	const dir = setupConsumerRepo();
	const parkOnWrite: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				return { text: '', exitCode: 1, rateLimited: true };
			}

			if (role === 'implement') {
				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};
	const config = await readConfig({ cwd: dir });
	const parked = await runImplementPipeline({ cwd: dir, driver: parkOnWrite, config, planPath: 'plan.md' });

	expect(parked.manifest.status).toBe('paused-rate-limit');

	const counts: Record<string, number> = {};
	const resumeDriver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			counts[role] = (counts[role] ?? 0) + 1;

			return { text: report(), exitCode: 0 };
		},
	};
	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runImplementPipeline({ cwd: dir, driver: resumeDriver, config, existing });

	expect(resumed.ok).toBe(true);
	// passed steps are not re-run
	expect(counts.implement ?? 0).toBe(0);
	// parked step re-runs — one writer per changed file
	expect(counts['write-tests']).toBe(2);
	// attempts continue across resume
	expect(resumed.manifest.steps.find((step) => step.id === 'write-tests')?.attempts).toBe(2);
});
