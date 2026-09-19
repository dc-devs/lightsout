import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readRunManifest } from '#src/runState/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// Agent failure modes: terminated reports, malformed output, per-writer
// failures, and driver exceptions — each recorded, never a zombie run.

test('terminated:* report escalates instead of failing', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({
			text: report({ status: 'terminated:ambiguity', failures: ['plan does not name the target module'] }),
			exitCode: 0,
		}),
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	expect(result.error ?? '').toMatch(/terminated:ambiguity/);
	expect(result.error ?? '').toMatch(/target module/);
});

test('malformed agent output is retried once, then fails the step', async () => {
	const dir = setupConsumerRepo();
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: 'not a json report', exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/did not match contract/);
	// one retry after the malformed report
	expect(calls).toBe(2);
});

test('write-tests aggregates per-file failures; terminated writers escalate', async () => {
	const run = async ({ failingStatus }: { failingStatus: string }) => {
		const dir = setupConsumerRepo();
		const driver: Driver = {
			name: 'stub',
			invoke: withTestChangeReview({
				invoke: async ({ prompt }) => {
					const role = roleOf(prompt);

					if (role === 'standards-review') {
						return { text: reviewReport(), exitCode: 0 };
					}

					if (role === 'implement') {
						writeSource({ dir, path: 'src/a.js', source: 'export const a = 1;\n' });
						writeSource({ dir, path: 'src/b.js', source: 'export const b = 1;\n' });

						return {
							text: report({
								changedFiles: [
									{ path: 'src/a.js', summary: 'a' },
									{ path: 'src/b.js', summary: 'b' },
								],
							}),
							exitCode: 0,
						};
					}

					if (role === 'write-tests') {
						if (prompt.includes('src/a.js')) {
							return { text: report({ status: failingStatus, failures: ['WRITER-FAILURE-SENTINEL'] }), exitCode: 0 };
						}

						return { text: report(), exitCode: 0 };
					}

					return { text: report(), exitCode: 0 };
				},
			}),
		};

		return runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });
	};

	const failed = await run({ failingStatus: 'failed' });

	expect(failed.manifest.status).toBe('failed');
	expect(failed.error ?? '').toMatch(/src\/a\.js/);
	expect(failed.error ?? '').toMatch(/WRITER-FAILURE-SENTINEL/);
	expect(failed.error ?? '').toMatch(/1 of 4/);

	const terminated = await run({ failingStatus: 'terminated:scope' });

	expect(terminated.manifest.status).toBe('escalated');
});

test('a driver exception (timeout, spawn failure) is a recorded failure, never a zombie', async () => {
	const dir = setupConsumerRepo();
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;
			throw new Error('claude timed out after 3600000ms');
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });
	const persisted = await readRunManifest({ cwd: dir, runId: result.manifest.runId });

	expect(result.ok).toBe(false);
	// manifest records the failure — no running zombie
	expect(persisted.status).toBe('failed');
	expect(result.error ?? '').toMatch(/agent invocation failed.*timed out/);
	// no blind retry after a timeout
	expect(calls).toBe(1);
});

/**
 * What a killed harness leaves behind: input-side counts from the messages it
 * streamed, and no output tokens or cost — a harness states those only in the
 * terminal result event a killed process never reaches.
 */
const streamedSpend = { inputTokens: 12, cacheReadTokens: 3400, cacheCreationTokens: 56 };

/** A run whose implement agent — the run's first and only agent call — streams what it burned and is then killed. */
const setupKilledAgentRun = async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ onUsage }) => {
			onUsage?.(streamedSpend);
			throw new Error('claude timed out after 3600000ms');
		},
	};
	const readLedger = (runId: string) =>
		readFileSync(join(dir, '.lightsout', 'runs', runId, 'agents.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);

	return { dir, driver, config: await readConfig({ cwd: dir }), readLedger };
};

test('a run halted by a killed agent still reports what that agent burned', async () => {
	const { dir, driver, config, readLedger } = await setupKilledAgentRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	const persisted = await readRunManifest({ cwd: dir, runId: result.manifest.runId });

	// the streamed counts survive the kill; what the harness never stated reads zero
	expect(persisted.usage).toStrictEqual({
		invocations: 1,
		inputTokens: 12,
		outputTokens: 0,
		cacheReadTokens: 3400,
		cacheCreationTokens: 56,
		costUsd: 0,
	});
	expect(readLedger(result.manifest.runId)).toEqual([
		{
			at: expect.any(String),
			step: 'implement',
			inputTokens: 12,
			outputTokens: 0,
			cacheReadTokens: 3400,
			cacheCreationTokens: 56,
			costUsd: 0,
		},
	]);
});

test("a killed agent's call is one invocation, not one per spawn", async () => {
	const { dir, driver, config, readLedger } = await setupKilledAgentRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	const persisted = await readRunManifest({ cwd: dir, runId: result.manifest.runId });

	// one agent call is billed once, however many spawns its ladder made
	expect(persisted.usage?.invocations).toBe(1);
	expect(readLedger(result.manifest.runId).length).toBe(1);
});
