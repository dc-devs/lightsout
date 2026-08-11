import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { verdict } from '@tests/helpers/verdict';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver, DriverResult } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

/**
 * A consumer repo whose unit gate goes red the moment implement lands (it
 * drops a BROKEN marker `testUnit` refuses) and never recovers, so
 * verify-implement always walks its full retry path. `fix` and `supervisor`
 * override what those two roles answer; `counts` records how many turns each
 * role was actually bought.
 */
const setupRedVerifyRun = async ({ fix, supervisor }: { fix?: () => DriverResult; supervisor?: () => DriverResult } = {}) => {
	const dir = setupConsumerRepo({ scripts: { testUnit: 'test ! -f BROKEN' } });
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
				return supervisor?.() ?? { text: verdict({ decision: 'escalate', diagnosis: 'stub diagnosis' }), exitCode: 0 };
			}

			if (role === 'fix') {
				return fix?.() ?? { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');
			writeFileSync(join(dir, 'BROKEN'), 'x');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, counts, config: await loadConfig({ cwd: dir }) };
};

test('verify: a rate limit inside a cheap fix retry parks the run before judgment is bought', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({ fix: () => ({ text: '', exitCode: 1, rateLimited: true }) });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	// the first rate-limited fix ends the step — the second retry is never spent
	expect(counts.fix).toBe(1);
	// a parked run never consults the supervisor
	expect(counts.supervisor).toBe(undefined);
	// the park keeps the record it entered the retry with — the aborted fix
	// advances nothing
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(2);
});

test('verify: a rate-limited supervisor parks the run after the cheap retries are spent', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({ supervisor: () => ({ text: '', exitCode: 1, rateLimited: true }) });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	// both mechanical retries ran before judgment was bought
	expect(counts.fix).toBe(2);
	// the supervisor was consulted exactly once
	expect(counts.supervisor).toBe(1);
});

test('verify: a retry verdict carrying no guidance escalates instead of buying a blind third fix', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		supervisor: () => ({ text: verdict({ decision: 'retry', diagnosis: 'DIAGNOSIS-SENTINEL' }), exitCode: 0 }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	// a retry with nothing to say buys no guided attempt
	expect(counts.fix).toBe(2);
	expect(result.error ?? '').toMatch(/verify-implement: still failing after retries\./);
	// the verdict is quoted with its decision
	expect(result.error ?? '').toMatch(/supervisor \(retry\): DIAGNOSIS-SENTINEL/);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.status).toBe('escalated');
});
