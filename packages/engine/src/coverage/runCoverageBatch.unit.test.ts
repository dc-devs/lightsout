import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { CoverageBatch } from '@/coverage/common/types/CoverageBatch';
import { runCoverageBatch } from '@/coverage/runCoverageBatch';
import type { Driver, DriverResult } from '@/drivers';

const target = 'src/target.ts';
const scopedTarget = 'packages/api/src/target.ts';
const summaryPath = 'coverage/coverage-summary.json';

/** An Istanbul summary naming the batch's file, or omitting it entirely. */
const writeSummary = ({ dir, pct }: { dir: string; pct?: number }) => {
	writeFileSync(
		join(dir, summaryPath),
		JSON.stringify({ total: { statements: { pct: pct ?? 40 } }, ...(pct === undefined ? {} : { [join(dir, target)]: { statements: { pct } } }) }),
	);
};

/**
 * A consumer repo whose coverage command is a no-op over a summary already on
 * disk: what the stub agent writes into that file IS the measurement, so an
 * improvement is expressed exactly as the real tooling would express it.
 */
const setupBatchRepo = ({ check = 'true' }: { check?: string } = {}) => {
	const dir = setupConsumerRepo({ scripts: { check, 'test-coverage': 'true' } });

	mkdirSync(join(dir, 'coverage'), { recursive: true });
	writeFileSync(join(dir, target), 'export const target = () => 1;\n');
	writeSummary({ dir, pct: 10 });
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	return dir;
};

/** An Istanbul summary for a package scope, written where that package's own measurement lands. */
const writeScopedSummary = ({ dir, pct }: { dir: string; pct: number }) => {
	writeFileSync(join(dir, 'packages/api', summaryPath), JSON.stringify({ total: { statements: { pct } }, [join(dir, scopedTarget)]: { statements: { pct } } }));
};

/**
 * A monorepo consumer measured per package: the batch's scope is a package, so
 * the summary it re-reads sits under that package rather than at the repo root.
 */
const setupScopedBatchRepo = () => {
	const dir = setupConsumerRepo({
		git: false,
		config: { 'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'true {package} run test:coverage' } },
	});

	mkdirSync(join(dir, 'packages/api/src'), { recursive: true });
	mkdirSync(join(dir, 'packages/api/coverage'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api', scripts: { 'test:coverage': 'x' } }));
	writeFileSync(join(dir, scopedTarget), 'export const target = () => 1;\n');
	writeScopedSummary({ dir, pct: 10 });
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	return dir;
};

const batchOf = ({ members = [target] }: { members?: string[] } = {}): CoverageBatch => ({
	id: 'batch-01:root',
	scope: 'root',
	files: [{ path: target, scope: 'root', statementsPct: 10 }],
	members,
});

/** A driver that runs `write` on every invocation and answers with the given payload (the last one repeats). */
const stubDriver = ({ write, results }: { write?: () => void; results: DriverResult[] }) => {
	const prompts: string[] = [];
	const systemPrompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			prompts.push(prompt);
			systemPrompts.push(systemPrompt ?? '');
			write?.();

			return results[Math.min(prompts.length - 1, results.length - 1)];
		},
	};

	return { driver, prompts, systemPrompts };
};

const runBatch = async ({ dir, driver, batch = batchOf(), testStandards }: { dir: string; driver: Driver; batch?: CoverageBatch; testStandards?: string }) =>
	runCoverageBatch({
		cwd: dir,
		runId: 'run-1',
		driver,
		config: await loadConfig({ cwd: dir }),
		batch,
		testStandards,
		agentTimeoutMs: 60_000,
		attributedFiles: [],
		onProgress: () => undefined,
		recordUsage: async () => undefined,
	});

/** The stub agent's deliverable: a test file, and the summary the next measurement reads. */
const writesTests = ({ dir, pct }: { dir: string; pct?: number }) => {
	return () => {
		writeFileSync(join(dir, 'src/target.unit.test.ts'), 'test("covers", () => undefined);\n');
		writeSummary({ dir, pct });
	};
};

const completed = [{ text: report({ changedFiles: [{ path: 'src/target.unit.test.ts', summary: 'covers target' }] }), exitCode: 0 }];

describe('runCoverageBatch', () => {
	test('a file whose statements percentage moved resolves the batch', async () => {
		const dir = setupBatchRepo();
		const { driver, prompts, systemPrompts } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: completed });

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind).toBe('done');
		expect(outcome.kind === 'done' && outcome.report).toStrictEqual({
			outcome: 'resolved',
			files: [{ path: target, beforePct: 10, afterPct: 80 }],
			rationale: [],
		});
		// the writer's list is the batch's members, not just its tracked candidates
		expect(prompts[0]).toContain(target);
		// the standalone banner rides in as the writer's plan, where the role prompt lives
		expect(systemPrompts[0]).toContain('Change no source file');
	});

	test('a component rider reaches the writer, so its boundary rule is satisfiable', async () => {
		const dir = setupBatchRepo();
		const { driver, prompts } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: completed });

		await runBatch({ dir, driver, batch: batchOf({ members: [target, 'src/boundary.ts'] }) });

		expect(prompts[0]).toContain('src/boundary.ts');
	});

	test('every member is both a surface the writer tests through and a file those tests must execute', async () => {
		const dir = setupBatchRepo();
		const { driver, prompts } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: completed });

		await runBatch({ dir, driver, batch: batchOf({ members: [target, 'src/boundary.ts'] }) });

		// a standalone run has no changed set to walk up from: the batch's own members are both lists
		const [testThrough, mustExecute] = prompts[0].split('# Changed internals');

		expect([testThrough, mustExecute]).toEqual([
			expect.stringContaining(`- ${target}\n- src/boundary.ts`),
			expect.stringContaining(`- ${target}\n- src/boundary.ts`),
		]);
	});

	test('tests written with nothing to show for them decline the batch', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({ write: writesTests({ dir, pct: 10 }), results: completed });

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind === 'done' && outcome.report.outcome).toBe('declined');
		expect(outcome.kind === 'done' && outcome.report.files).toStrictEqual([{ path: target, beforePct: 10, afterPct: 10 }]);
	});

	test('a file the fresh summary no longer names counts as unimproved, never as covered', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({ write: writesTests({ dir, pct: undefined }), results: completed });

		// the writer covered nothing the measurement can see
		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind === 'done' && outcome.report.outcome).toBe('declined');
	});

	test('a source file the agent modified fails the batch, naming it and what the human must undo', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({
			write: () => {
				writeFileSync(join(dir, target), 'export const target = () => 2;\n');
			},
			results: completed,
		});

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind).toBe('failed');
		expect(outcome.kind === 'failed' && outcome.error).toContain(target);
		// the engine never reverts, and a resumed run would measure the contaminated tree
		expect(outcome.kind === 'failed' && outcome.error).toMatch(/revert these changes by hand before resuming/);
	});

	test('the consumer’s test standards ride in the writer’s system prompt, where the run caches them', async () => {
		const dir = setupBatchRepo();
		const { driver, systemPrompts } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: completed });

		await runBatch({ dir, driver, testStandards: 'Assert an output value, never merely that a call did not throw.' });

		expect(systemPrompts[0]).toContain('Assert an output value, never merely that a call did not throw.');
	});

	test('the writer’s friction travels into the batch report a human reads', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({
			write: writesTests({ dir, pct: 80 }),
			results: [
				{
					text: report({
						changedFiles: [{ path: 'src/target.unit.test.ts', summary: 'covers target' }],
						friction: [{ kind: 'decision', area: 'plan', detail: 'no plan names this module' }],
					}),
					exitCode: 0,
				},
			],
		});

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind === 'done' && outcome.report.rationale).toStrictEqual(['[plan] no plan names this module']);
	});

	test("the measurement's own output never counts as a source edit", async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: completed });

		const outcome = await runBatch({ dir, driver });

		// the summary file is modified on every round — it must not fail the run it serves
		expect(outcome.kind).toBe('done');
		expect(outcome.kind === 'done' && outcome.changedFiles).toStrictEqual(['src/target.unit.test.ts']);
	});

	test('a package writes its summary under its own directory, and that is not a source edit either', async () => {
		const dir = setupScopedBatchRepo();
		const batch: CoverageBatch = {
			id: 'batch-01:api',
			scope: 'api',
			files: [{ path: scopedTarget, scope: 'api', statementsPct: 10 }],
			members: [scopedTarget],
		};
		const { driver } = stubDriver({
			write: () => {
				writeFileSync(join(dir, 'packages/api/src/target.unit.test.ts'), 'test("covers", () => undefined);\n');
				writeScopedSummary({ dir, pct: 80 });
			},
			results: [{ text: report({ changedFiles: [{ path: 'packages/api/src/target.unit.test.ts', summary: 'covers target' }] }), exitCode: 0 }],
		});

		const outcome = await runBatch({ dir, driver, batch });

		expect(outcome.kind === 'done' && outcome.report.outcome).toBe('resolved');
		expect(outcome.kind === 'done' && outcome.changedFiles).toStrictEqual(['packages/api/src/target.unit.test.ts']);
	});

	test('a scope refusal is a decline that carries the agent’s own words, not a run stop', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({
			results: [{ text: report({ status: 'terminated:scope', failures: ['12 files is more than one writer can cover honestly'] }), exitCode: 0 }],
		});

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind === 'done' && outcome.report.outcome).toBe('declined');
		expect(outcome.kind === 'done' && outcome.report.rationale).toStrictEqual(['[scope] 12 files is more than one writer can cover honestly']);
	});

	test('a writer that reports failed is the routine set-aside case — declined, with its reasons attached', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({
			results: [{ text: report({ status: 'failed', failures: ['the module cannot be tested without splitting it'] }), exitCode: 0 }],
		});

		const outcome = await runBatch({ dir, driver });

		// the writer's role prompt reports failed exactly when source looks defective
		expect(outcome.kind === 'done' && outcome.report.outcome).toBe('declined');
		expect(outcome.kind === 'done' && outcome.report.rationale).toStrictEqual(['[failed] the module cannot be tested without splitting it']);
	});

	test('an ambiguity the writer cannot resolve escalates the run instead', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({ results: [{ text: report({ status: 'terminated:ambiguity', failures: ['which module owns this?'] }), exitCode: 0 }] });

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind).toBe('escalated');
	});

	test('a rate-limited harness parks the batch rather than failing it', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({ results: [{ text: '', exitCode: 1, rateLimited: true }] });

		expect((await runBatch({ dir, driver })).kind).toBe('parked');
	});

	test('a rate limit during a fix re-invocation parks too, mid-batch', async () => {
		const dir = setupBatchRepo({ check: 'false' });
		const { driver, prompts } = stubDriver({
			write: writesTests({ dir, pct: 80 }),
			results: [completed[0], { text: '', exitCode: 1, rateLimited: true }],
		});

		expect((await runBatch({ dir, driver })).kind).toBe('parked');
		// the fix invocation carries the gate output
		expect(prompts[1]).toContain('# Verification failure');
	});

	test('a red gate the writer fixes lets the batch finish, measured on the tree that fix left', async () => {
		// the gate goes green once the marker exists, which only the fix invocation writes
		const dir = setupBatchRepo({ check: '[ -f coverage/fixed ]' });
		let invocations = 0;
		const { driver, prompts } = stubDriver({
			write: () => {
				invocations += 1;
				writesTests({ dir, pct: 80 })();

				if (invocations === 2) {
					writeFileSync(join(dir, 'coverage/fixed'), '');
				}
			},
			results: completed,
		});

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind === 'done' && outcome.report.outcome).toBe('resolved');
		// one cheap fix was enough — the second batch never spent the second retry
		expect(prompts.length).toBe(2);
	});

	test('a fix invocation that reaches for source fails the batch, exactly as the first one would', async () => {
		const dir = setupBatchRepo({ check: 'false' });
		let invocations = 0;
		const { driver } = stubDriver({
			write: () => {
				invocations += 1;

				if (invocations === 1) {
					writesTests({ dir, pct: 80 })();

					return;
				}

				writeFileSync(join(dir, target), 'export const target = () => 2;\n');
			},
			results: completed,
		});

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind).toBe('failed');
		expect(outcome.kind === 'failed' && outcome.error).toContain(target);
	});

	test('a gate still red after the cheap fixes fails the batch with the gate output', async () => {
		const dir = setupBatchRepo({ check: 'false' });
		const { driver, prompts } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: completed });

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind).toBe('failed');
		expect(outcome.kind === 'failed' && outcome.error).toMatch(/gates still red after 2 fix attempt\(s\)/);
		// the first invocation plus two cheap fixes, and no supervisor
		expect(prompts.length).toBe(3);
	});

	test('an agent that finished its work but never reported is salvaged when coverage moved and gates are green', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: [{ text: 'I wrote the tests.', exitCode: 0 }] });

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind === 'done' && outcome.report.outcome).toBe('resolved');
		expect(outcome.kind === 'done' && outcome.report.rationale.join('\n')).toMatch(/salvaged/);
	});

	test('salvage never waives the tests-only rule — a dying agent’s source edit fails the batch', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({
			write: () => {
				writeFileSync(join(dir, target), 'export const target = () => 2;\n');
				writeSummary({ dir, pct: 80 });
			},
			results: [{ text: 'no report', exitCode: 0 }],
		});

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind).toBe('failed');
		expect(outcome.kind === 'failed' && outcome.error).toContain(target);
	});

	test('an unreported invocation whose coverage moved is still refused while the gates are red', async () => {
		const dir = setupBatchRepo({ check: 'false' });
		const { driver } = stubDriver({ write: writesTests({ dir, pct: 80 }), results: [{ text: 'no report', exitCode: 0 }] });

		const outcome = await runBatch({ dir, driver });

		// salvage classifies work the gates verified — an unverifiable tree is not that
		expect(outcome.kind).toBe('failed');
		expect(outcome.kind === 'failed' && outcome.error).toMatch(/did not match contract/);
	});

	test('an unreported invocation that moved nothing fails with the invocation failure', async () => {
		const dir = setupBatchRepo();
		const { driver } = stubDriver({ results: [{ text: 'no report', exitCode: 0 }] });

		const outcome = await runBatch({ dir, driver });

		expect(outcome.kind).toBe('failed');
		expect(outcome.kind === 'failed' && outcome.error).toMatch(/did not match contract/);
	});
});
