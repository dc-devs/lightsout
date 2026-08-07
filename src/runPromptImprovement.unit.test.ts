import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
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

	expect(result.friction).toStrictEqual([]);
	// no friction means no invocation at all, not an invocation with no report
	expect(result.status).toBe('no-friction');
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

	// corrupt lines skipped, valid ones kept
	expect(result.friction.length).toBe(1);
	expect(result.status === 'invoked' && result.outcome.ok && result.outcome.report.status).toBe('complete');
	expect(received.includes('IMPROVER-SENTINEL')).toBeTruthy();
	// kind and area ride along
	expect(received.includes('[decision/plan]')).toBeTruthy();
	// editable prompt files listed
	expect(received.includes('src/agents/prompts/featureExecutor.md')).toBeTruthy();
});

test('the resolved model and effort ride the improver invocation at the write capability level', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();

	seedFriction({ cwd: consumerCwd });

	const invocations: DriverInvocation[] = [];
	const driver = recordingDriver({ invocations });
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver, model: 'gpt-5.2', effort: Effort.XHigh });

	expect(result.status === 'invoked' && result.outcome.ok && result.outcome.report.status).toBe('complete');
	// the caller-resolved model and effort reach the harness; the improver edits
	// prompt files, so it needs write
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([{ model: 'gpt-5.2', effort: 'xhigh', permissions: 'write' }]);
});

test('an unset effort reaches the driver undefined, while the write level still stands', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();

	seedFriction({ cwd: consumerCwd });

	const invocations: DriverInvocation[] = [];
	const driver = recordingDriver({ invocations });
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver });

	expect(result.status === 'invoked' && result.outcome.ok && result.outcome.report.status).toBe('complete');
	// the harness default stands for an unset effort; the capability level belongs
	// to the role, never to a config read
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([{ model: undefined, effort: undefined, permissions: 'write' }]);
});

test('only the markdown files in the prompts directory are offered as editable surface', async () => {
	const consumerCwd = setupConsumerRepo({ git: false });
	const engineCwd = setupEngineRepo();

	seedFriction({ cwd: consumerCwd });
	writeFileSync(join(engineCwd, 'src/agents/prompts/scratch.txt'), 'not a role prompt\n');

	const invocations: DriverInvocation[] = [];
	const driver = recordingDriver({ invocations });
	const result = await runPromptImprovement({ consumerCwd, engineCwd, driver });

	expect(result.status === 'invoked' && result.outcome.ok && result.outcome.report.status).toBe('complete');
	// prompts are listed repo-relative, as the improver must address them
	expect(invocations[0]?.prompt.includes('- src/agents/prompts/featureExecutor.md')).toBeTruthy();
	// a non-markdown neighbour is not the improver’s to edit
	expect(invocations[0]?.prompt.includes('scratch.txt')).toBeFalsy();
});
