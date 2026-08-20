import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const stubUsage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 };

/**
 * A happy-path run whose stub driver records the permission level PipelineRun
 * resolves for every working role, plus the on-disk usage ledger those
 * invocations leave behind.
 */
const setupPolicyRun = async ({ config }: { config?: Record<string, unknown> } = {}) => {
	const dir = setupConsumerRepo({ config });
	const invocations: { role: string; permissions?: Permissions }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, permissions }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			invocations.push({ role, permissions });

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0, usage: stubUsage };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0, usage: stubUsage };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0, usage: stubUsage };
		},
	};

	const loaded = await loadConfig({ cwd: dir });
	const readLedger = (runId: string) =>
		readFileSync(join(dir, '.lightsout', 'runs', runId, 'agents.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);

	return { dir, driver, config: loaded, invocations, readLedger };
};

/** The distinct values a field took across a run's invocations or ledger lines. */
const distinct = <Value>(values: Value[]) => [...new Set(values)];

describe('PipelineRun agent policy', () => {
	test('defaults every working role to write permissions when config sets none', async () => {
		const { dir, driver, config, invocations } = await setupPolicyRun();

		const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(result.ok).toBe(true);
		// the stub driver was invoked
		expect(invocations.length > 0).toBeTruthy();
		// every working role runs at the write level: ${JSON.stringify(invocations)}
		expect(distinct(invocations.map((invocation) => invocation.permissions))).toStrictEqual(['write']);
	});

	test('passes a configured full-access level to every working role', async () => {
		const { dir, driver, config, invocations } = await setupPolicyRun({ config: { permissions: 'full-access' } });

		const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(result.ok).toBe(true);
		// the configured level replaces the default: ${JSON.stringify(invocations)}
		expect(distinct(invocations.map((invocation) => invocation.permissions))).toStrictEqual(['full-access']);
	});

	test('records the resolved effort beside the model on every usage ledger line', async () => {
		const { dir, driver, config, readLedger } = await setupPolicyRun({ config: { model: 'stub-model', effort: 'xhigh' } });

		const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(result.ok).toBe(true);

		const ledger = readLedger(result.manifest.runId);

		// cost is explainable after the fact: ${JSON.stringify(ledger)}
		expect(distinct(ledger.map((record) => `${String(record.model)}/${String(record.effort)}`))).toStrictEqual(['stub-model/xhigh']);
	});

	test('omits effort from ledger lines when config sets none', async () => {
		const { dir, driver, config, readLedger } = await setupPolicyRun({ config: { model: 'stub-model' } });

		const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(result.ok).toBe(true);

		const ledger = readLedger(result.manifest.runId);

		// an unset effort leaves no key to misread: ${JSON.stringify(ledger)}
		expect(distinct(ledger.map((record) => Object.hasOwn(record, 'effort')))).toStrictEqual([false]);
		// the model still lands on every line
		expect(distinct(ledger.map((record) => record.model))).toStrictEqual(['stub-model']);
	});
});
