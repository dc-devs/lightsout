import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { BatchReport } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

/** Split a multi-export file in two, each half with the caller that uses it — an unreferenced half is its own blocking finding. */
const splitFile = ({ dir, file, first, second }: { dir: string; file: string; first: string; second: string }) => {
	writeSource({ dir, path: file, source: `export const ${first} = 1;\n` });
	writeSource({ dir, path: file.replace(/[^/]+\.ts$/, `${second}.ts`), source: `export const ${second} = 2;\n` });
};

/**
 * Two multi-export findings in ONE folder — a single batch carrying two
 * clusters, the arrangement a partial pass and its requeue need.
 */
const setupTwoFindingBatch = async () => {
	const dir = setupConsumerRepo();

	writeSource({ dir, path: 'src/one.ts', source: 'export const alphaOne = 1;\nexport const betaOne = 2;\n' });
	writeSource({ dir, path: 'src/two.ts', source: 'export const alphaTwo = 1;\nexport const betaTwo = 2;\n' });
	commitAll(dir);

	const prompts: string[] = [];

	return { dir, prompts, config: await readConfig({ cwd: dir }) };
};

/**
 * Two multi-export findings in SEPARATE folders — two batches, so one
 * batch's work can invalidate the next batch's frozen clusters.
 */
const setupTwoBatchRun = async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeSource({ dir, path: `${folder}/multi.ts`, source: multiExport });
	}

	commitAll(dir);

	return { dir, config: await readConfig({ cwd: dir }) };
};

/**
 * One finding plus a `check` gate that stays red while broken.flag exists —
 * the executor plants the flag, so verification fails on work that otherwise
 * resolved the cluster.
 */
const setupRedGateBatch = async () => {
	const dir = setupConsumerRepo({ scripts: { check: 'test ! -f broken.flag' } });

	writeSource({ dir, path: 'src/multi.ts', source: multiExport });
	commitAll(dir);

	const prompts: string[] = [];
	const gateBreakingExecutor: Driver['invoke'] = async ({ prompt }) => {
		if (roleOf(prompt) === 'standards-review') {
			return { text: reviewReport(), exitCode: 0 };
		}

		prompts.push(prompt);

		splitFile({ dir, file: 'src/multi.ts', first: 'alphaThing', second: 'betaThing' });
		writeFileSync(join(dir, 'broken.flag'), 'red\n');

		return {
			text: report({
				changedFiles: [
					{ path: 'src/multi.ts', summary: 'split' },
					{ path: 'src/betaThing.ts', summary: 'split' },
				],
			}),
			exitCode: 0,
		};
	};

	return { dir, prompts, gateBreakingExecutor, config: await readConfig({ cwd: dir }) };
};

describe('runRefactorPipeline batch outcomes', () => {
	test('a batch whose clusters earlier work already resolved spends no agent', async () => {
		const { dir, config } = await setupTwoBatchRun();

		const invocations: string[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

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

		expect(result.ok).toBe(true);
		// the second batch was verified resolved on disk, not re-sent to an agent
		expect(invocations.length).toBe(1);
		expect(result.after['multi-export'] ?? 0).toBe(0);

		const beta = result.manifest.steps.find((step) => step.id === 'batch-02:multi-export:beta');

		expect(beta?.status).toBe('passed');
		// the skipped batch is still recorded as resolved
		expect(beta?.report).toStrictEqual({ outcome: 'resolved', remainingSiteKeys: [], rationale: [] });
		// and attributes nothing — the earlier batch already owns those files
		expect(beta?.changedFiles).toStrictEqual([]);
	});

	test('a pass that resolves only part of a batch requeues the survivors alone', async () => {
		const { dir, prompts, config } = await setupTwoFindingBatch();

		let pass = 0;
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				prompts.push(prompt);
				pass += 1;

				const file = pass === 1 ? 'src/one.ts' : 'src/two.ts';

				splitFile({ dir, file, first: `alpha${pass}`, second: `beta${pass}` });

				return { text: report({ changedFiles: [{ path: file, summary: 'split' }] }), exitCode: 0 };
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		// the requeue finished the batch
		expect(result.after['multi-export'] ?? 0).toBe(0);
		// exactly one requeue — the executor pass, then the remainder
		expect(prompts.length).toBe(2);
		// the requeue carries the surviving finding:\n${prompts[1]}
		expect(prompts[1]?.includes('src/two.ts')).toBeTruthy();
		// and never re-sends resolved work — read off the work-list itself, since
		// the advisory context beneath it legitimately spans the whole batch:
		// \n${prompts[1]}
		expect(prompts[1]?.split('Advisory —')[0]?.includes('src/one.ts')).toBeFalsy();
	});

	test('a requeue that resolves nothing declines with the surviving clusters named', async () => {
		const { dir, prompts, config } = await setupTwoFindingBatch();

		let pass = 0;
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

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

		// a spent requeue is a decline, never a run failure
		expect(result.ok).toBe(true);
		// the requeue is not repeated once spent
		expect(prompts.length).toBe(2);
		// what survived is named for the human, not swallowed
		expect(result.declined.map(({ batchId, remainingSiteKeys }) => ({ batchId, remainingSiteKeys }))).toStrictEqual([
			{ batchId: 'batch-01:multi-export:src', remainingSiteKeys: ['multi-export:src/two.ts'] },
		]);
		// the resolved half still burned down
		expect(result.after['multi-export'] ?? 0).toBe(1);
	});

	test('an invocation that produces no report and no verifiable work fails the run', async () => {
		const dir = setupConsumerRepo();

		writeSource({ dir, path: 'src/multi.ts', source: multiExport });
		commitAll(dir);

		const driver: Driver = {
			name: 'stub',
			invoke: async () => ({ text: 'I thought about it and stopped.', exitCode: 1 }),
		};
		const result = await runRefactorPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

		// unverifiable work is never salvaged
		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('failed');
		// the failure names the batch it stopped at
		expect(result.error ?? '').toMatch(/batch-01:multi-export:src: /);
		expect(result.error ?? '').toMatch(/did not match contract/);
		// nothing burned down
		expect(result.after['multi-export'] ?? 0).toBe(1);
	});

	for (const { status, expected } of [
		{ status: 'failed', expected: 'failed' },
		{ status: 'terminated:ambiguity', expected: 'escalated' },
	]) {
		test(`a '${status}' batch report stops the run as ${expected}`, async () => {
			const dir = setupConsumerRepo();

			writeSource({ dir, path: 'src/multi.ts', source: multiExport });
			commitAll(dir);

			const driver: Driver = {
				name: 'stub',
				invoke: async () => ({ text: report({ status, failures: ['the module boundary is a human call'] }), exitCode: 0 }),
			};
			const result = await runRefactorPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

			expect(result.ok).toBe(false);
			expect(result.manifest.status).toBe(expected);
			// the agent’s own failure text is the evidence
			expect(result.error ?? '').toMatch(/the module boundary is a human call/);
		});
	}

	test('a cheap fix rescues a red gate without spending a supervisor consult', async () => {
		const { dir, prompts, gateBreakingExecutor, config } = await setupRedGateBatch();
		const driver: Driver = {
			name: 'stub',
			invoke: async (invocation) => {
				if (roleOf(invocation.prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				if (invocation.prompt.includes('# Verification failure')) {
					prompts.push(invocation.prompt);
					rmSync(join(dir, 'broken.flag'));

					return { text: report(), exitCode: 0 };
				}

				return gateBreakingExecutor(invocation);
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		// the batch resolved once the gate went green
		expect(result.after['multi-export'] ?? 0).toBe(0);
		// one executor pass plus one cheap fix
		expect(prompts.length).toBe(2);
		// judgment is only bought when the mechanical retries are exhausted
		expect(prompts.every((prompt) => !prompt.includes('# Failing step'))).toBeTruthy();
	});

	test('an invocation failure whose work is done but whose gates are red is not salvaged', async () => {
		const { dir, config } = await setupRedGateBatch();
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				splitFile({ dir, file: 'src/multi.ts', first: 'alphaThing', second: 'betaThing' });
				writeFileSync(join(dir, 'broken.flag'), 'red\n');

				return { text: 'no json here — the process died mid-report', exitCode: 1 };
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		// the clusters are gone from the tree, but a red gate is not "work verified"
		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('failed');
		// the failure names the batch it stopped at
		expect(result.error ?? '').toMatch(/batch-01:multi-export:src: /);
		// and is never re-labelled as a resolution
		expect(JSON.stringify(result.manifest.steps).includes('salvaged')).toBeFalsy();
	});

	test('a rate-limited cheap fix parks the run instead of failing it', async () => {
		const { dir, prompts, gateBreakingExecutor, config } = await setupRedGateBatch();
		const driver: Driver = {
			name: 'stub',
			invoke: async (invocation) => {
				if (roleOf(invocation.prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				if (invocation.prompt.includes('# Verification failure')) {
					prompts.push(invocation.prompt);

					return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
				}

				return gateBreakingExecutor(invocation);
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(false);
		// a rate limit mid-fix is pausable state, never an error
		expect(result.manifest.status).toBe('paused-rate-limit');
		// the run stopped at the rate-limited fix — no second retry, no supervisor
		expect(prompts.length).toBe(2);
	});

	test('the agent’s answer about each advisory is accumulated across the batch and persisted with it', async () => {
		const { dir, config } = await setupTwoFindingBatch();

		let pass = 0;
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				pass += 1;

				// The first pass resolves one cluster and answers for one advisory;
				// the requeue revisits that same site and lands on a different answer.
				splitFile({ dir, file: pass === 1 ? 'src/one.ts' : 'src/two.ts', first: `alpha${pass}`, second: `beta${pass}` });

				return {
					text: report({
						changedFiles: [{ path: pass === 1 ? 'src/one.ts' : 'src/two.ts', summary: 'split' }],
						advisoryOutcomes: [
							{
								rule: 'size-function',
								siteKey: 'size-function:src/one.ts',
								outcome: pass === 1 ? 'declined' : 'applied',
								...(pass === 1 ? { reason: 'orchestration exemption' } : {}),
							},
							...(pass === 2
								? [{ rule: 'dead-export', siteKey: 'dead-export:src/two.ts', outcome: 'declined', reason: 'deleting an export is a public-API change' }]
								: []),
						],
					}),
					exitCode: 0,
				};
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);

		const persisted = BatchReport.parse(result.manifest.steps.find((step) => step.id.startsWith('batch-'))?.report);

		// the requeue's answer about a site replaces the first pass's, and a site
		// only the requeue spoke about is kept alongside it
		expect(persisted.advisoryOutcomes).toStrictEqual([
			{ rule: 'size-function', siteKey: 'size-function:src/one.ts', outcome: 'applied' },
			{ rule: 'dead-export', siteKey: 'dead-export:src/two.ts', outcome: 'declined', reason: 'deleting an export is a public-API change' },
		]);
	});
});
