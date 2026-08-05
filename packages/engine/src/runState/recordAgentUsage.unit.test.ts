import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import type { RunUsage } from '@lightsout/contracts';
import { recordAgentUsage } from './index';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

/** One invocation's spend, every field a different number so a mix-up shows. */
const usage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 880, cacheCreationTokens: 110, costUsd: 0.5 };

interface SetupParams {
	/** The run's live aggregate — a resumed run starts from the manifest's totals. */
	totals?: RunUsage;
	/** A line already on the ledger, so appending-vs-rewriting is observable. */
	priorLine?: Record<string, unknown>;
}

const setupLedger = ({ totals, priorLine }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const runId = 'run-ledger';
	const ledgerPath = join(cwd, '.lightsout', 'runs', runId, 'agents.jsonl');
	const runTotals: RunUsage = totals ?? {
		invocations: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		costUsd: 0,
	};

	if (priorLine) {
		mkdirSync(dirname(ledgerPath), { recursive: true });
		writeFileSync(ledgerPath, `${JSON.stringify(priorLine)}\n`, 'utf8');
	}

	const readLedger = () =>
		readFileSync(ledgerPath, 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);

	return { cwd, runId, totals: runTotals, ledgerPath, readLedger };
};

describe('recordAgentUsage', () => {
	test('writes one agents.jsonl line carrying the step, model, effort, and the invocation usage', async () => {
		const { cwd, runId, totals, readLedger } = setupLedger();

		await recordAgentUsage({ cwd, runId, step: 'implement', model: 'stub-model', effort: 'xhigh', totals, usage });

		const [{ at, ...record }] = readLedger();

		assert.deepEqual(record, {
			step: 'implement',
			model: 'stub-model',
			effort: 'xhigh',
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
		});
		assert.match(String(at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'every spend is stamped with when it happened');
	});

	test('creates the run directory for a run that has written nothing yet', async () => {
		const { cwd, runId, totals, ledgerPath } = setupLedger();

		await recordAgentUsage({ cwd, runId, step: 'implement', totals, usage });

		assert.ok(existsSync(ledgerPath), `the ledger lands at .lightsout/runs/<runId>/agents.jsonl: ${ledgerPath}`);
	});

	test('omits the model and effort keys when neither is in force', async () => {
		const { cwd, runId, totals, readLedger } = setupLedger();

		await recordAgentUsage({ cwd, runId, step: 'implement', totals, usage });

		const [record] = readLedger();

		assert.equal(Object.hasOwn(record, 'model'), false, 'an unset model leaves no key to misread as a real setting');
		assert.equal(Object.hasOwn(record, 'effort'), false, 'an unset effort means the harness default, not a recorded level');
		assert.equal(record.step, 'implement');
	});

	test('adds the invocation onto the totals the run already carries rather than replacing them', async () => {
		const { cwd, runId, totals } = setupLedger({
			totals: { invocations: 2, inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.25 },
		});

		await recordAgentUsage({ cwd, runId, step: 'refactor', totals, usage });

		assert.deepEqual(totals, {
			invocations: 3,
			inputTokens: 11,
			outputTokens: 102,
			cacheReadTokens: 883,
			cacheCreationTokens: 114,
			costUsd: 0.75,
		});
	});

	test('appends beside the lines a run already has instead of rewriting the ledger', async () => {
		const { cwd, runId, totals, readLedger } = setupLedger({
			priorLine: { at: '2026-01-01T00:00:00.000Z', step: 'implement', ...usage },
		});

		await recordAgentUsage({ cwd, runId, step: 'write-tests', totals, usage });

		const ledger = readLedger();

		assert.equal(ledger.length, 2, `every spend leaves its own line: ${JSON.stringify(ledger)}`);
		assert.deepEqual(
			ledger.map((record) => record.step),
			['implement', 'write-tests'],
		);
	});

	test('leaves no ledger line and no spend when the driver reported no usage', async () => {
		const { cwd, runId, totals, ledgerPath } = setupLedger();

		await recordAgentUsage({ cwd, runId, step: 'implement', model: 'stub-model', effort: 'high', totals });

		assert.equal(existsSync(ledgerPath), false, 'a driver that proves nothing bills nothing');
		assert.deepEqual(totals, {
			invocations: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
			costUsd: 0,
		});
	});
});
