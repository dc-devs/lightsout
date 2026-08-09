import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { WorkReport } from '@/contracts';
import { invokeAgentWithContract } from '@/invoke/invokeAgentWithContract';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { outcomeFields } from '@tests/helpers/outcomeFields';

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

	const { report: parsed, usage } = outcomeFields(await invokeAgentWithContract({
		driver,
		cwd: '.',
		invocation: { systemPrompt: 's', prompt: 'p' },
		contract: WorkReport,
	}));

	expect(parsed).toBeTruthy();
	expect(usage?.outputTokens).toBe(150);
	expect(usage?.inputTokens).toBe(20);
	expect(usage?.costUsd).toBe(1);
});

test('an attempt reporting no usage does not zero the invocation total', async () => {
	let calls = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return calls === 1 ? { text: 'no json here', exitCode: 0 } : { text: report(), exitCode: 0, usage: stubUsage(50) };
		},
	};

	const { report: parsed, usage } = outcomeFields(await invokeAgentWithContract({
		driver,
		cwd: '.',
		invocation: { systemPrompt: 's', prompt: 'p' },
		contract: WorkReport,
	}));

	expect(parsed).toBeTruthy();
	expect(usage).toStrictEqual({ inputTokens: 10, outputTokens: 50, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 });
});

test('usage spent before a rate limit is still reported — a parked run is billed for what it burned', async () => {
	let calls = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return calls === 1
				? { text: 'no json here', exitCode: 0, usage: stubUsage(100) }
				: { text: '', exitCode: 1, rateLimited: true, usage: stubUsage(20) };
		},
	};

	const { rateLimited, usage } = outcomeFields(await invokeAgentWithContract({
		driver,
		cwd: '.',
		invocation: { systemPrompt: 's', prompt: 'p' },
		contract: WorkReport,
	}));

	expect(rateLimited).toBe(true);
	expect(usage).toStrictEqual({ inputTokens: 20, outputTokens: 120, cacheReadTokens: 2000, cacheCreationTokens: 10, costUsd: 1 });
});

test('usage spent before a driver throw is still reported', async () => {
	let calls = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			if (calls === 1) {
				return { text: 'no json here', exitCode: 0, usage: stubUsage(100) };
			}

			throw new Error('spawn ENOENT');
		},
	};

	const { failure, usage } = outcomeFields(await invokeAgentWithContract({
		driver,
		cwd: '.',
		invocation: { systemPrompt: 's', prompt: 'p' },
		contract: WorkReport,
	}));

	expect(failure).toBe('agent invocation failed: spawn ENOENT');
	expect(usage).toStrictEqual({ inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 });
});

test('pipeline writes agents.jsonl per invocation and aggregates usage into the manifest', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

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

	expect(result.ok).toBe(true);

	// implement + 1 test writer + refactor = 3 invocations
	const ledger = readFileSync(join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	expect(ledger.length).toBe(3);
	expect(ledger.map((record) => record.step)).toStrictEqual(['implement', 'write-tests', 'refactor']);
	expect(ledger[0].outputTokens).toBe(100);

	expect(result.manifest.usage?.invocations).toBe(3);
	expect(result.manifest.usage?.outputTokens).toBe(600);
	expect(result.manifest.usage?.inputTokens).toBe(30);
	expect(result.manifest.usage?.cacheReadTokens).toBe(3000);
	expect(result.manifest.usage?.costUsd).toBe(1.5);

	// usage narrated:\n${progressLines.filter((line) =>
	// line.includes('usage')).join('\n')}
	expect(progressLines.some((line) => line.includes('implement · usage: in 10 · out 100 · cache-read 1.0k · $0.50'))).toBeTruthy();
});

test('a driver reporting no usage leaves no ledger and no manifest aggregate', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

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

	expect(result.ok).toBe(true);
	expect(result.manifest.usage).toBe(undefined);
	expect(() => readFileSync(join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents.jsonl'))).toThrow();
});
