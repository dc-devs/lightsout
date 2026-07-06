import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { WorkReport } from '@lightsout/contracts';
import { invokeAgentWithContract } from '../src/invoke/invokeAgentWithContract';
import { loadConfig, runImplementPipeline } from '../src/index';
import { report } from './helpers/report';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

const roleInvocation = { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' };

test('contract mismatch retries with a cheap re-emit invocation, not the full role prompt', async () => {
	const prompts: string[] = [];
	const systemPrompts: (string | undefined)[] = [];
	const rejections: { text: string; attempt: number }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			prompts.push(prompt);
			systemPrompts.push(systemPrompt);

			// First: no extractable JSON at all. Second: the re-emitted report.
			return prompts.length === 1
				? { text: 'I did lots of work! No JSON here though.', exitCode: 0 }
				: { text: report({ summary: 're-emitted' }), exitCode: 0 };
		},
	};

	const { report: parsed, failure } = await invokeAgentWithContract({
		driver,
		cwd: '.',
		invocation: roleInvocation,
		contract: WorkReport,
		onRejectedOutput: ({ text, attempt }) => {
			rejections.push({ text, attempt });
		},
	});

	assert.equal(failure, undefined);
	assert.equal(parsed?.summary, 're-emitted');
	assert.equal(prompts.length, 2);
	assert.equal(prompts[0], 'ROLE-PROMPT');
	assert.ok(prompts[1].includes('Re-emit your report'), 'retry is the re-emit prompt');
	assert.ok(prompts[1].includes('I did lots of work! No JSON here though.'), 'retry carries the rejected text');
	assert.ok(!prompts[1].includes('ROLE-PROMPT'), 'retry does NOT re-run the role prompt');
	assert.equal(systemPrompts[1], 'ROLE-SYSTEM-PROMPT', 'role system prompt (the contract) rides along');
	assert.deepEqual(rejections, [{ text: 'I did lots of work! No JSON here though.', attempt: 1 }]);
});

test('two contract mismatches fail the invocation and report both rejections', async () => {
	const rejections: number[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({ text: 'still not a report', exitCode: 0 }),
	};

	const { report: parsed, failure } = await invokeAgentWithContract({
		driver,
		cwd: '.',
		invocation: roleInvocation,
		contract: WorkReport,
		onRejectedOutput: ({ attempt }) => {
			rejections.push(attempt);
		},
	});

	assert.equal(parsed, undefined);
	assert.match(failure ?? '', /did not match contract/);
	assert.deepEqual(rejections, [1, 2]);
});

test('pipeline persists rejected agent output to the run dir as evidence', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({ text: 'prose with no report in it', exitCode: 0 }),
	};

	const config = await loadConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	assert.equal(result.ok, false);

	const agentsDir = join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents');

	assert.ok(existsSync(agentsDir), 'agents evidence dir exists');

	const files = readdirSync(agentsDir).sort();

	assert.deepEqual(files, ['rejected-01-implement-attempt1.txt', 'rejected-02-implement-attempt2.txt']);

	const first = readFileSync(join(agentsDir, files[0]), 'utf8');

	assert.ok(first.includes('# step: implement'), 'provenance header');
	assert.ok(first.includes('prose with no report in it'), 'raw text preserved');
});
