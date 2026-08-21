import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { Effort, Permissions, WorkReport } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';
import { report } from '#tests/helpers/report.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const roleInvocation = { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' };

/**
 * A driver that records every invocation it is handed and answers with the
 * given texts in order (the last is reused once they run out).
 */
const capturingDriver = ({ invocations, texts }: { invocations: DriverInvocation[]; texts: string[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: texts[Math.min(invocations.length - 1, texts.length - 1)], exitCode: 0 };
	},
});

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

	const { report: parsed, failure } = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			onRejectedOutput: ({ text, attempt }) => {
				rejections.push({ text, attempt });
			},
		}),
	);

	expect(failure).toBe(undefined);
	expect(parsed?.summary).toBe('re-emitted');
	expect(prompts.length).toBe(2);
	expect(prompts[0]).toBe('ROLE-PROMPT');
	// retry is the re-emit prompt
	expect(prompts[1].includes('Re-emit your report')).toBeTruthy();
	// retry carries the rejected text
	expect(prompts[1].includes('I did lots of work! No JSON here though.')).toBeTruthy();
	// retry does NOT re-run the role prompt
	expect(prompts[1].includes('ROLE-PROMPT')).toBeFalsy();
	// role system prompt (the contract) rides along
	expect(systemPrompts[1]).toBe('ROLE-SYSTEM-PROMPT');
	expect(rejections).toStrictEqual([{ text: 'I did lots of work! No JSON here though.', attempt: 1 }]);
});

test('two contract mismatches fail the invocation and report both rejections', async () => {
	const rejections: number[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({ text: 'still not a report', exitCode: 0 }),
	};

	const { report: parsed, failure } = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			onRejectedOutput: ({ attempt }) => {
				rejections.push(attempt);
			},
		}),
	);

	expect(parsed).toBe(undefined);
	expect(failure ?? '').toMatch(/did not match contract/);
	expect(rejections).toStrictEqual([1, 2]);
});

test('the resolved model, effort and permissions reach the driver verbatim', async () => {
	const invocations: DriverInvocation[] = [];
	const driver = capturingDriver({ invocations, texts: [report()] });

	const { failure } = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '/repo',
			invocation: roleInvocation,
			contract: WorkReport,
			model: 'gpt-5.2',
			effort: Effort.High,
			permissions: Permissions.FullAccess,
			allowedCommands: ['pnpm test'],
			timeoutMs: 1234,
		}),
	);

	expect(failure).toBe(undefined);
	expect(
		invocations.map(({ model, effort, permissions, allowedCommands, cwd, timeoutMs }) => ({ model, effort, permissions, allowedCommands, cwd, timeoutMs })),
	).toStrictEqual([{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access', allowedCommands: ['pnpm test'], cwd: '/repo', timeoutMs: 1234 }]);
});

test('the read-only level is relayed untranslated — the driver, not this chokepoint, maps it to a harness flag', async () => {
	const invocations: DriverInvocation[] = [];
	const driver = capturingDriver({ invocations, texts: [report()] });

	const { failure } = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			permissions: Permissions.ReadOnly,
		}),
	);

	expect(failure).toBe(undefined);
	expect(invocations[0].permissions).toBe('read-only');
});

test('an unset model, effort or permissions reaches the driver undefined — no default is invented here', async () => {
	const invocations: DriverInvocation[] = [];
	const driver = capturingDriver({ invocations, texts: [report()] });

	const { report: parsed } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport }));

	expect(parsed).toBeTruthy();
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: undefined, effort: undefined, permissions: undefined },
	]);
});

test('the re-emit retry runs at the same model, effort and permissions as the first attempt', async () => {
	const invocations: DriverInvocation[] = [];
	const driver = capturingDriver({ invocations, texts: ['no report in this prose', report({ summary: 're-emitted' })] });

	const { report: parsed } = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			model: 'sonnet',
			effort: Effort.Low,
			permissions: Permissions.Write,
		}),
	);

	expect(parsed?.summary).toBe('re-emitted');
	// a retry must not silently downgrade the effort or capability level
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: 'sonnet', effort: 'low', permissions: 'write' },
		{ model: 'sonnet', effort: 'low', permissions: 'write' },
	]);
});

test('a driver that throws is returned as a step failure — never retried blindly', async () => {
	const invocations: DriverInvocation[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			throw new Error('harness timed out after 1000ms');
		},
	};

	const outcome = await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport });

	expect(outcome).toStrictEqual({
		ok: false,
		failure: 'agent invocation failed: harness timed out after 1000ms',
		rateLimited: false,
		usage: undefined,
	});
	// a second identical timeout would only double the cost of learning the
	// ceiling is low
	expect(invocations.length).toBe(1);
});

test('a driver that throws a non-Error value still yields a readable failure', async () => {
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw 'spawn EACCES';
		},
	};

	const {
		report: parsed,
		failure,
		rateLimited,
	} = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
		}),
	);

	expect(parsed).toBe(undefined);
	expect(failure).toBe('agent invocation failed: spawn EACCES');
	expect(rateLimited).toBe(false);
});

test('a rate-limited harness is reported as such so the engine can park the run', async () => {
	const invocations: DriverInvocation[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text: 'usage limit reached, try again later', exitCode: 1, rateLimited: true };
		},
	};

	const outcome = await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport });

	expect(outcome).toStrictEqual({ ok: false, failure: 'harness rate limited or overloaded', rateLimited: true, usage: undefined });
	// a rate limit ends the attempt loop — a re-emit retry would hit the same wall
	expect(invocations.length).toBe(1);
});

test('a rate limit on the re-emit retry is reported over the earlier contract failure', async () => {
	const invocations: DriverInvocation[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return invocations.length === 1 ? { text: 'no report in this prose', exitCode: 0 } : { text: '', exitCode: 1, rateLimited: true };
		},
	};

	const {
		report: parsed,
		failure,
		rateLimited,
	} = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
		}),
	);

	expect(parsed).toBe(undefined);
	expect(rateLimited).toBe(true);
	expect(failure).toBe('harness rate limited or overloaded');
	expect(invocations.length).toBe(2);
});

test('the stream event callback is relayed to the driver verbatim', async () => {
	const events: unknown[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ onEvent }) => {
			onEvent?.({ type: 'tool_use' });

			return { text: report(), exitCode: 0 };
		},
	};

	const { failure } = outcomeFields(
		await invokeAgentWithContract({
			driver,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			onEvent: (event) => events.push(event),
		}),
	);

	expect(failure).toBe(undefined);
	expect(events).toStrictEqual([{ type: 'tool_use' }]);
});

test('pipeline persists rejected agent output to the run dir as evidence', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({ text: 'prose with no report in it', exitCode: 0 }),
	};

	const config = await readConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	expect(result.ok).toBe(false);

	const agentsDir = join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents');

	// agents evidence dir exists
	expect(existsSync(agentsDir)).toBeTruthy();

	const files = readdirSync(agentsDir).sort();

	expect(files).toStrictEqual(['rejected-01-implement-attempt1.txt', 'rejected-02-implement-attempt2.txt']);

	const first = readFileSync(join(agentsDir, files[0]), 'utf8');

	// provenance header
	expect(first.includes('# step: implement')).toBeTruthy();
	// raw text preserved
	expect(first.includes('prose with no report in it')).toBeTruthy();
});
