import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

/** Split a multi-export file into two single-export files — the edit that resolves its cluster. */
const splitFile = ({ dir, file, first, second }: { dir: string; file: string; first: string; second: string }) => {
	writeFileSync(join(dir, file), `export const ${first} = 1;\n`);
	writeFileSync(join(dir, file.replace(/[^/]+\.ts$/, `${second}.ts`)), `export const ${second} = 2;\n`);
};

/**
 * Two multi-export findings in ONE folder — a single batch carrying two
 * clusters, the arrangement a partial pass and its requeue need.
 */
const setupTwoFindingBatch = async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/one.ts'), 'export const alphaOne = 1;\nexport const betaOne = 2;\n');
	writeFileSync(join(dir, 'src/two.ts'), 'export const alphaTwo = 1;\nexport const betaTwo = 2;\n');
	commitAll(dir);

	const prompts: string[] = [];

	return { dir, prompts, config: await loadConfig({ cwd: dir }) };
};

/**
 * Two multi-export findings in SEPARATE folders — two batches, so one
 * batch's work can invalidate the next batch's frozen clusters.
 */
const setupTwoBatchRun = async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	return { dir, config: await loadConfig({ cwd: dir }) };
};

/**
 * One finding plus a `check` gate that stays red while broken.flag exists —
 * the executor plants the flag, so verification fails on work that otherwise
 * resolved the cluster.
 */
const setupRedGateBatch = async () => {
	const dir = setupConsumerRepo({ scripts: { check: 'test ! -f broken.flag' } });

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	const prompts: string[] = [];
	const gateBreakingExecutor: Driver['invoke'] = async ({ prompt }) => {
		prompts.push(prompt);

		splitFile({ dir, file: 'src/multi.ts', first: 'alphaThing', second: 'betaThing' });
		writeFileSync(join(dir, 'broken.flag'), 'red\n');

		return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }, { path: 'src/betaThing.ts', summary: 'split' }] }), exitCode: 0 };
	};

	return { dir, prompts, gateBreakingExecutor, config: await loadConfig({ cwd: dir }) };
};

describe('runRefactorPipeline batch outcomes', () => {
	test('a batch whose clusters earlier work already resolved spends no agent', async () => {
		const { dir, config } = await setupTwoBatchRun();

		const invocations: string[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				invocations.push(prompt);

				// The alpha batch's agent reaches into beta too — by the time the
				// beta batch comes up, its frozen clusters are already gone.
				for (const folder of ['alpha', 'beta']) {
					splitFile({ dir, file: `${folder}/multi.ts`, first: 'alphaThing', second: 'betaThing' });
				}

				return {
					text: report({
						changedFiles: ['alpha/multi.ts', 'alpha/betaThing.ts', 'beta/multi.ts', 'beta/betaThing.ts'].map((path) => ({ path, summary: 'split' })),
					}),
					exitCode: 0,
				};
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		assert.equal(result.ok, true, result.error);
		assert.equal(invocations.length, 1, 'the second batch was verified resolved on disk, not re-sent to an agent');
		assert.equal(result.after['structure'] ?? 0, 0);

		const beta = result.manifest.steps.find((step) => step.id === 'batch-02:structure:beta');

		assert.equal(beta?.status, 'passed');
		assert.deepEqual(beta?.report, { outcome: 'resolved', remainingClusters: [], rationale: [] }, 'the skipped batch is still recorded as resolved');
		assert.deepEqual(beta?.changedFiles, [], 'and attributes nothing — the earlier batch already owns those files');
	});

	test('a pass that resolves only part of a batch requeues the survivors alone', async () => {
		const { dir, prompts, config } = await setupTwoFindingBatch();

		let pass = 0;
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				prompts.push(prompt);
				pass += 1;

				const file = pass === 1 ? 'src/one.ts' : 'src/two.ts';

				splitFile({ dir, file, first: `alpha${pass}`, second: `beta${pass}` });

				return { text: report({ changedFiles: [{ path: file, summary: 'split' }] }), exitCode: 0 };
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		assert.equal(result.ok, true, result.error);
		assert.equal(result.after['structure'] ?? 0, 0, 'the requeue finished the batch');
		assert.equal(prompts.length, 2, 'exactly one requeue — the executor pass, then the remainder');
		assert.ok(prompts[1]?.includes('src/two.ts'), `the requeue carries the surviving finding:\n${prompts[1]}`);
		assert.ok(!prompts[1]?.includes('src/one.ts'), `and never re-sends resolved work:\n${prompts[1]}`);
	});

	test('a requeue that resolves nothing declines with the surviving clusters named', async () => {
		const { dir, prompts, config } = await setupTwoFindingBatch();

		let pass = 0;
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				prompts.push(prompt);
				pass += 1;

				if (pass > 1) {
					return { text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'src/two.ts is exempt by design' }] }), exitCode: 0 };
				}

				splitFile({ dir, file: 'src/one.ts', first: 'alphaOne', second: 'betaOne' });

				return { text: report({ changedFiles: [{ path: 'src/one.ts', summary: 'split' }] }), exitCode: 0 };
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		assert.equal(result.ok, true, 'a spent requeue is a decline, never a run failure');
		assert.equal(prompts.length, 2, 'the requeue is not repeated once spent');
		assert.deepEqual(
			result.declined.map(({ batchId, remainingClusters }) => ({ batchId, remainingClusters })),
			[{ batchId: 'batch-01:structure:src', remainingClusters: ['multi-export:src/two.ts'] }],
			'what survived is named for the human, not swallowed',
		);
		assert.equal(result.after['structure'] ?? 0, 1, 'the resolved half still burned down');
	});

	test('an invocation that produces no report and no verifiable work fails the run', async () => {
		const dir = setupConsumerRepo();

		writeFileSync(join(dir, 'src/multi.ts'), multiExport);
		commitAll(dir);

		const driver: Driver = {
			name: 'stub',
			invoke: async () => ({ text: 'I thought about it and stopped.', exitCode: 1 }),
		};
		const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

		assert.equal(result.ok, false, 'unverifiable work is never salvaged');
		assert.equal(result.manifest.status, 'failed');
		assert.match(result.error ?? '', /batch-01:structure:src: /, 'the failure names the batch it stopped at');
		assert.match(result.error ?? '', /did not match contract/);
		assert.equal(result.after['structure'] ?? 0, 1, 'nothing burned down');
	});

	for (const { status, expected } of [
		{ status: 'failed', expected: 'failed' },
		{ status: 'terminated:ambiguity', expected: 'escalated' },
	]) {
		test(`a '${status}' batch report stops the run as ${expected}`, async () => {
			const dir = setupConsumerRepo();

			writeFileSync(join(dir, 'src/multi.ts'), multiExport);
			commitAll(dir);

			const driver: Driver = {
				name: 'stub',
				invoke: async () => ({ text: report({ status, failures: ['the module boundary is a human call'] }), exitCode: 0 }),
			};
			const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

			assert.equal(result.ok, false);
			assert.equal(result.manifest.status, expected);
			assert.match(result.error ?? '', /the module boundary is a human call/, 'the agent’s own failure text is the evidence');
		});
	}

	test('a cheap fix rescues a red gate without spending a supervisor consult', async () => {
		const { dir, prompts, gateBreakingExecutor, config } = await setupRedGateBatch();
		const driver: Driver = {
			name: 'stub',
			invoke: async (invocation) => {
				if (invocation.prompt.includes('# Verification failure')) {
					prompts.push(invocation.prompt);
					rmSync(join(dir, 'broken.flag'));

					return { text: report(), exitCode: 0 };
				}

				return gateBreakingExecutor(invocation);
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		assert.equal(result.ok, true, result.error);
		assert.equal(result.after['structure'] ?? 0, 0, 'the batch resolved once the gate went green');
		assert.equal(prompts.length, 2, 'one executor pass plus one cheap fix');
		assert.ok(
			prompts.every((prompt) => !prompt.includes('# Failing step')),
			'judgment is only bought when the mechanical retries are exhausted',
		);
	});

	test('a rate-limited cheap fix parks the run instead of failing it', async () => {
		const { dir, prompts, gateBreakingExecutor, config } = await setupRedGateBatch();
		const driver: Driver = {
			name: 'stub',
			invoke: async (invocation) => {
				if (invocation.prompt.includes('# Verification failure')) {
					prompts.push(invocation.prompt);

					return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
				}

				return gateBreakingExecutor(invocation);
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		assert.equal(result.ok, false);
		assert.equal(result.manifest.status, 'paused-rate-limit', 'a rate limit mid-fix is pausable state, never an error');
		assert.equal(prompts.length, 2, 'the run stopped at the rate-limited fix — no second retry, no supervisor');
	});
});
