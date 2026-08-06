import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alpha = 1;\nexport const beta = 2;\n';

const stubUsage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 };

/**
 * A two-batch refactor run whose stub driver declines both batches — a decline
 * still spends, so each invocation leaves a line on the run's usage ledger.
 */
const setupLedgerRun = async ({ config }: { config?: Record<string, unknown> } = {}) => {
	const dir = setupConsumerRepo({ config });

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({
			text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'left as-is: exempt by design' }] }),
			exitCode: 0,
			usage: stubUsage,
		}),
	};

	const loaded = await loadConfig({ cwd: dir });
	const readLedger = (runId: string) =>
		readFileSync(join(dir, '.lightsout', 'runs', runId, 'agents.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);

	return { dir, driver, config: loaded, readLedger };
};

/** The distinct values a field took across the run's ledger lines. */
const distinct = <Value>(values: Value[]) => [...new Set(values)];

describe('runRefactorPipeline usage ledger', () => {
	test('records the resolved effort beside the model on every ledger line', async () => {
		const { dir, driver, config, readLedger } = await setupLedgerRun({ config: { model: 'stub-model', effort: 'xhigh' } });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);

		const ledger = readLedger(result.manifest.runId);

		// both batches spent, so both left a line: ${JSON.stringify(ledger)}
		expect(ledger.length).toBe(2);
		// a refactor run's cost is explainable after the fact:
		// ${JSON.stringify(ledger)}
		expect(distinct(ledger.map((record) => `${String(record.model)}/${String(record.effort)}`))).toStrictEqual(['stub-model/xhigh']);
	});

	test('omits effort from ledger lines when config sets none', async () => {
		const { dir, driver, config, readLedger } = await setupLedgerRun({ config: { model: 'stub-model' } });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);

		const ledger = readLedger(result.manifest.runId);

		// an unset effort leaves no key to misread as a real setting:
		// ${JSON.stringify(ledger)}
		expect(distinct(ledger.map((record) => Object.hasOwn(record, 'effort')))).toStrictEqual([false]);
		// the model still lands on every line
		expect(distinct(ledger.map((record) => record.model))).toStrictEqual(['stub-model']);
	});
});
