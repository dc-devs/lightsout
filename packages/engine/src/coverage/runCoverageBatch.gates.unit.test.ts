// The gate-and-salvage half of runCoverageBatch, split from
// runCoverageBatch.unit.test.ts when that file passed the test-file line cap.
// Its fixtures are its own: the rule that forced the split says each half
// carries what it needs, and test files are exempt from the duplication rules.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import { runCoverageBatch } from '#src/coverage/runCoverageBatch.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import { report } from '#tests/helpers/report.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

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
const _setupScopedBatchRepo = () => {
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
		config: await readConfig({ cwd: dir }),
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

describe('runCoverageBatch gates and salvage', () => {
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
