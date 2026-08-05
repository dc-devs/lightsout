import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver, DriverResult } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { verdict } from '@tests/helpers/verdict';

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

	assert.equal(result.manifest.status, 'paused-rate-limit');
	assert.ok(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`), result.error);
	assert.equal(counts['fix'], 1, 'the first rate-limited fix ends the step — the second retry is never spent');
	assert.equal(counts['supervisor'], undefined, 'a parked run never consults the supervisor');
	assert.equal(
		result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts,
		2,
		'the park keeps the record it entered the retry with — the aborted fix advances nothing',
	);
});

test('verify: a rate-limited supervisor parks the run after the cheap retries are spent', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({ supervisor: () => ({ text: '', exitCode: 1, rateLimited: true }) });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	assert.equal(result.manifest.status, 'paused-rate-limit');
	assert.ok(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`), result.error);
	assert.equal(counts['fix'], 2, 'both mechanical retries ran before judgment was bought');
	assert.equal(counts['supervisor'], 1, 'the supervisor was consulted exactly once');
});

test('verify: a retry verdict carrying no guidance escalates instead of buying a blind third fix', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		supervisor: () => ({ text: verdict({ decision: 'retry', diagnosis: 'DIAGNOSIS-SENTINEL' }), exitCode: 0 }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	assert.equal(result.manifest.status, 'escalated');
	assert.equal(counts['fix'], 2, 'a retry with nothing to say buys no guided attempt');
	assert.match(result.error ?? '', /verify-implement: still failing after retries\./);
	assert.match(result.error ?? '', /supervisor \(retry\): DIAGNOSIS-SENTINEL/, 'the verdict is quoted with its decision');
	assert.equal(result.manifest.steps.find((step) => step.id === 'verify-implement')?.status, 'escalated');
});
