import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effort } from '@/contracts';
import type { Driver, DriverInvocation } from '@/drivers';
import { runPromptImprovement } from '@/runPromptImprovement';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

const setupEngineRepo = () => {
	const dir = setupConsumerRepo({ git: false });

	mkdirSync(join(dir, 'src/agents/prompts'), { recursive: true });
	writeFileSync(join(dir, 'src/agents/prompts/featureExecutor.md'), '# Role\n');

	return dir;
};

/** One valid friction record, so the improver gets past its short-circuit and invokes the driver. */
const seedFriction = ({ cwd }: { cwd: string }) => {
	mkdirSync(join(cwd, '.lightsout'), { recursive: true });
	writeFileSync(
		join(cwd, '.lightsout', 'friction.jsonl'),
		`${JSON.stringify({ kind: 'friction', area: 'prompt', detail: 'the role prompt was ambiguous', at: '2026-07-03T00:00:00.000Z', runId: 'run-1234', step: 'implement' })}\n`,
	);
};

/** A stub improver that records every invocation it is handed and returns a valid WorkReport. */
const recordingDriver = ({ invocations }: { invocations: DriverInvocation[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: report(), exitCode: 0 };
	},
});

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
	assert.ok(received.includes('src/agents/prompts/featureExecutor.md'), 'editable prompt files listed');
});

test('the resolved model and effort ride the improver invocation at the write capability level', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();

	seedFriction({ cwd: consumerCwd });

	const invocations: DriverInvocation[] = [];
	const driver = recordingDriver({ invocations });
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver, model: 'gpt-5.2', effort: Effort.XHigh });

	assert.equal(result.report?.status, 'complete');
	assert.deepEqual(
		invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions })),
		[{ model: 'gpt-5.2', effort: 'xhigh', permissions: 'write' }],
		'the caller-resolved model and effort reach the harness; the improver edits prompt files, so it needs write',
	);
});

test('an unset effort reaches the driver undefined, while the write level still stands', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();

	seedFriction({ cwd: consumerCwd });

	const invocations: DriverInvocation[] = [];
	const driver = recordingDriver({ invocations });
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver });

	assert.equal(result.report?.status, 'complete');
	assert.deepEqual(
		invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions })),
		[{ model: undefined, effort: undefined, permissions: 'write' }],
		'the harness default stands for an unset effort; the capability level belongs to the role, never to a config read',
	);
});

test('only the markdown files in the prompts directory are offered as editable surface', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();

	seedFriction({ cwd: consumerCwd });
	writeFileSync(join(engineCwd, 'src/agents/prompts/scratch.txt'), 'not a role prompt\n');

	const invocations: DriverInvocation[] = [];
	const driver = recordingDriver({ invocations });
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver });

	assert.equal(result.report?.status, 'complete');
	assert.ok(invocations[0]?.prompt.includes('- src/agents/prompts/featureExecutor.md'), 'prompts are listed repo-relative, as the improver must address them');
	assert.ok(!invocations[0]?.prompt.includes('scratch.txt'), 'a non-markdown neighbour is not the improver’s to edit');
});
