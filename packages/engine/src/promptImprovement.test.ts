import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { runPromptImprovement } from './index';
import { report } from '../tests/helpers/report';
import { setupConsumerRepo } from '../tests/helpers/setupConsumerRepo';

const setupEngineRepo = () => {
	const dir = setupConsumerRepo({ git: false });

	mkdirSync(join(dir, 'packages/agents/prompts'), { recursive: true });
	writeFileSync(join(dir, 'packages/agents/prompts/featureExecutor.md'), '# Role\n');

	return dir;
};

test('empty friction short-circuits without invoking the driver', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('driver must not be invoked when there is no friction');
		},
	};
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver });

	assert.deepEqual(result.friction, []);
	assert.equal(result.report, undefined);
	assert.equal(result.rateLimited, false);
});

test('accumulated friction reaches the improver with kind, provenance, and prompt files', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();

	mkdirSync(join(consumerCwd, '.lightsout'), { recursive: true });
	writeFileSync(
		join(consumerCwd, '.lightsout', 'friction.jsonl'),
		`${JSON.stringify({ kind: 'decision', area: 'plan', detail: 'IMPROVER-SENTINEL', at: '2026-07-03T00:00:00.000Z', runId: 'run-1234', step: 'implement' })}\n` +
			'this line is corrupt and must be skipped\n',
	);

	let received = '';
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			received = prompt;

			return { text: report(), exitCode: 0 };
		},
	};
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver });

	assert.equal(result.friction.length, 1, 'corrupt lines skipped, valid ones kept');
	assert.equal(result.report?.status, 'complete');
	assert.ok(received.includes('IMPROVER-SENTINEL'));
	assert.ok(received.includes('[decision/plan]'), 'kind and area ride along');
	assert.ok(received.includes('packages/agents/prompts/featureExecutor.md'), 'editable prompt files listed');
});
