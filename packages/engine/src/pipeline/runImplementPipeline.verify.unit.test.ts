import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * A consumer repo whose unit gate goes red the moment implement lands (it
 * drops a BROKEN marker the `test` gate refuses) and never recovers, so
 * verify-implement always walks its full retry path. `fix` and `supervisor`
 * override what those two roles answer; `counts` records how many turns each
 * role was actually bought.
 */
const setupRedVerifyRun = async ({ fix, supervisor }: { fix?: () => DriverResult; supervisor?: () => DriverResult } = {}) => {
	const dir = setupConsumerRepo({ scripts: { test: 'test ! -f BROKEN' } });
	const counts: Record<string, number> = {};
	// A re-emit retry hands the rejected text back to the SAME role, but its
	// prompt carries none of that role's markers. Invocations here are strictly
	// sequential, so the role that just answered is the role being retried.
	let lastRole = 'implement';
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = prompt.includes('# Your previous final message') ? lastRole : roleOf(prompt);

			lastRole = role;

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

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
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

test('verify: a verdict that never parses buys one re-emit retry, then escalates with no ruling to quote', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		supervisor: () => ({ text: 'The gate looks wrong to me — I have no JSON for you.', exitCode: 0 }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	// the contract re-emit is the only extra turn a malformed verdict buys
	expect(counts.supervisor).toBe(2);
	// no ruling survived, so no guided retry was spent either
	expect(counts.fix).toBe(2);
	expect(result.error ?? '').toMatch(/verify-implement: still failing after retries\./);
	// nothing is attributed to a supervisor that never ruled
	expect(result.error ?? '').not.toMatch(/supervisor \(/);
	// the red gate is still the evidence the escalation carries
	expect(result.error ?? '').toMatch(/test failed/);
});

test('verify: a rate limit inside the supervisor-guided retry parks the run instead of escalating it', async () => {
	let fixTurns = 0;
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		fix: () => {
			fixTurns += 1;

			// The two cheap retries answer normally; the guided third — the one the
			// supervisor's ruling bought — is where the harness runs out.
			return fixTurns === 3 ? { text: '', exitCode: 1, rateLimited: true } : { text: report(), exitCode: 0 };
		},
		supervisor: () => ({ text: verdict({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' }), exitCode: 0 }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// a park a human can resume, never the escalation an exhausted path gives
	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	expect(counts.supervisor).toBe(1);
	// the guided attempt was bought before the limit hit
	expect(counts.fix).toBe(3);
	// and it is recorded, so a resume does not silently re-buy it
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(4);
});

test('verify: a fix invocation whose driver dies spends its turn without failing the step — the gate still decides', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		fix: () => {
			throw new Error('claude timed out after 3600000ms');
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// a dead fix is neither a run failure of its own nor a reason to cut the
	// retry budget short — the still-red gate is what ends the step
	expect(result.manifest.status).toBe('escalated');
	expect(counts.fix).toBe(2);
	expect(counts.supervisor).toBe(1);
	expect(result.error ?? '').toMatch(/supervisor \(escalate\): stub diagnosis/);
});

test('verify: a fix reporting failed earns no changed-file attribution — only a complete report is merged', async () => {
	const { dir, driver, config } = await setupRedVerifyRun({
		fix: () => ({
			text: report({ status: 'failed', failures: ['could not find the cause'], changedFiles: [{ path: 'src/ghost.js', summary: 'never written' }] }),
			exitCode: 0,
		}),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	// the file a failed fix claimed never becomes the run's truth
	expect(result.manifest.changedFiles.includes('src/ghost.js')).toBe(false);
	// what implement actually landed is still attributed
	expect(result.manifest.changedFiles.includes('src/feature.js')).toBe(true);
});
