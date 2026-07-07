import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { WorkReport } from '@lightsout/contracts';
import { invokeAgentWithContract } from './invokeAgentWithContract';
import { loadConfig, runImplementPipeline } from '../index';
import { report } from '../../tests/helpers/report';
import { roleOf } from '../../tests/helpers/roleOf';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

const stubUsage = (outputTokens: number) => ({
	inputTokens: 10,
	outputTokens,
	cacheReadTokens: 1000,
	cacheCreationTokens: 5,
	costUsd: 0.5,
});

test('usage sums across a re-emit retry — one role invocation, one bill', async () => {
	let calls = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return calls === 1
				? { text: 'no json here', exitCode: 0, usage: stubUsage(100) }
				: { text: report(), exitCode: 0, usage: stubUsage(50) };
		},
	};

	const { report: parsed, usage } = await invokeAgentWithContract({
		driver,
		cwd: '.',
		invocation: { systemPrompt: 's', prompt: 'p' },
		contract: WorkReport,
	});

	assert.ok(parsed);
	assert.equal(usage?.outputTokens, 150);
	assert.equal(usage?.inputTokens, 20);
	assert.equal(usage?.costUsd, 1);
});

test('pipeline writes agents.jsonl per invocation and aggregates usage into the manifest', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0, usage: stubUsage(200) };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0, usage: stubUsage(300) };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0, usage: stubUsage(100) };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const progressLines: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		planPath: 'plan.md',
		driver,
		config,
		onProgress: (message) => progressLines.push(message),
	});

	assert.equal(result.ok, true);

	// implement + 1 test writer + refactor = 3 invocations
	const ledger = readFileSync(join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	assert.equal(ledger.length, 3);
	assert.deepEqual(
		ledger.map((record) => record.step),
		['implement', 'write-tests', 'refactor'],
	);
	assert.equal(ledger[0].outputTokens, 100);

	assert.equal(result.manifest.usage?.invocations, 3);
	assert.equal(result.manifest.usage?.outputTokens, 600);
	assert.equal(result.manifest.usage?.inputTokens, 30);
	assert.equal(result.manifest.usage?.cacheReadTokens, 3000);
	assert.equal(result.manifest.usage?.costUsd, 1.5);

	assert.ok(
		progressLines.some((line) => line.includes('implement · usage: in 10 · out 100 · cache-read 1.0k · $0.50')),
		`usage narrated:\n${progressLines.filter((line) => line.includes('usage')).join('\n')}`,
	);
});

test('a driver reporting no usage leaves no ledger and no manifest aggregate', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	assert.equal(result.ok, true);
	assert.equal(result.manifest.usage, undefined);
	assert.throws(() => readFileSync(join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents.jsonl')));
});
