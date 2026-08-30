import { describe, expect, test } from '@jest/globals';
import { WorkReport } from '#src/contracts/index.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';
import { report } from '#tests/helpers/report.ts';

const roleInvocation = { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' };

/**
 * A final message that IS valid JSON but not a valid WorkReport — `summary`
 * must be a string. There is an object to reconstruct from, so it earns the
 * cheap re-emit whatever the ceiling.
 */
const objectBearingRejection = report({ summary: 42 });

/** Prose with no `{` in it at all — nothing a re-emit could restate as a report. */
const objectFreeRejection = 'the plan looks fine to me';

/**
 * A final message that parses as JSON but yields no object at all — the literal
 * `null`. A payload was found, so this is not the object-free prose case, yet
 * there is still nothing for a re-emit to reconstruct a report from.
 */
const nullRejection = 'null';

/**
 * A driver answering with the given replies in order, recording the prompt and
 * the system prompt of every rung it was handed, plus a rejection sink
 * recording what it was given. A rung is told apart by its prompt: a re-emit is
 * the one carrying `# Validation error`, a fresh role invocation is the role
 * prompt itself.
 *
 * A reply list shorter than the rungs the ladder climbs repeats its last entry,
 * so a test that only cares "this never satisfies the contract" says it once.
 */
const setupRerun = ({ replies }: { replies: DriverResult[] }) => {
	const prompts: string[] = [];
	const systemPrompts: (string | undefined)[] = [];
	const rejections: { text: string; attempt: number; validationError: string }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			prompts.push(prompt);
			systemPrompts.push(systemPrompt);

			return replies[Math.min(prompts.length - 1, replies.length - 1)];
		},
	};

	const onRejectedOutput = (params: { text: string; attempt: number; validationError: string }) => {
		rejections.push(params);
	};

	const isReemit = (prompt: string) => prompt.includes('# Validation error');

	return { driver, prompts, systemPrompts, rejections, onRejectedOutput, isReemit };
};

describe('invokeAgentWithContract: the re-run ceiling', () => {
	test('a ceiling of two re-runs the role from scratch after the first invocation and its re-emit both fail', async () => {
		const { driver, prompts, onRejectedOutput, isReemit } = setupRerun({
			replies: [
				{ text: objectBearingRejection, exitCode: 0 },
				{ text: objectBearingRejection, exitCode: 0 },
				{ text: report({ summary: 'answered on the second role attempt' }), exitCode: 0 },
			],
		});

		const { report: parsed, failure } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2, onRejectedOutput }),
		);

		expect(failure).toBe(undefined);
		expect(parsed?.summary).toBe('answered on the second role attempt');
		// role, its cheap re-emit, then the role again from scratch
		expect(prompts.map(isReemit)).toStrictEqual([false, true, false]);
		expect(prompts[2]).toBe(roleInvocation.prompt);
	});

	test('a ceiling of two is a ceiling: four spawns at the very worst, then the call gives up', async () => {
		const { driver, prompts, onRejectedOutput } = setupRerun({ replies: [{ text: objectBearingRejection, exitCode: 0 }] });

		const { ok, rateLimited, failure } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2, onRejectedOutput }),
		);

		expect(ok).toBe(false);
		expect(rateLimited).toBe(false);
		expect(failure ?? '').toMatch(/did not match contract/);
		// two role invocations, each with its one re-emit — and no fifth spawn
		expect(prompts.length).toBe(4);
	});

	test('a rejection holding no object skips the futile re-emit and spends the next fresh invocation instead', async () => {
		const { driver, prompts, onRejectedOutput, isReemit } = setupRerun({ replies: [{ text: objectFreeRejection, exitCode: 0 }] });

		const { ok } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2, onRejectedOutput }),
		);

		expect(ok).toBe(false);
		// role, role — asking an agent to restate a one-line error message as a
		// report cannot succeed, so neither rung buys one
		expect(prompts.length).toBe(2);
		expect(prompts.some(isReemit)).toBe(false);
	});

	test('the attempt number keeps rising across the whole ladder, so no rung overwrites what an earlier one left', async () => {
		const { driver, rejections, onRejectedOutput } = setupRerun({ replies: [{ text: objectBearingRejection, exitCode: 0 }] });

		await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2, onRejectedOutput });

		// a counter that restarted per role invocation would write attempts
		// 1, 2, 1, 2 — and silently lose the first invocation's two payloads
		expect(rejections.map(({ attempt }) => attempt)).toStrictEqual([1, 2, 3, 4]);
	});

	test('a wall on the first rung returns at once — the ceiling never multiplies a rate limit', async () => {
		const { driver, prompts } = setupRerun({ replies: [{ text: '', exitCode: 1, rateLimited: true }] });

		const { ok, rateLimited } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2 }),
		);

		expect(ok).toBe(false);
		expect(rateLimited).toBe(true);
		expect(prompts.length).toBe(1);
	});

	test('a wall met on a later rung returns from that rung, carrying the usage the earlier rungs burned', async () => {
		const usage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 };
		const { driver, prompts } = setupRerun({
			replies: [
				{ text: objectFreeRejection, exitCode: 0, usage },
				{ text: '', exitCode: 1, rateLimited: true, usage },
			],
		});

		const { rateLimited, usage: total } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2 }),
		);

		expect(rateLimited).toBe(true);
		expect(prompts.length).toBe(2);
		// a parked run is billed for what it burned climbing to the wall
		expect(total).toStrictEqual({ inputTokens: 20, outputTokens: 200, cacheReadTokens: 2000, cacheCreationTokens: 10, costUsd: 1 });
	});

	test('a driver that throws returns at once — a timeout or a spawn failure buys no re-run', async () => {
		let calls = 0;
		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				calls += 1;

				throw new Error('spawn ENOENT');
			},
		};

		const { ok, rateLimited, failure } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2 }),
		);

		expect(ok).toBe(false);
		expect(rateLimited).toBe(false);
		expect(failure).toBe('agent invocation failed: spawn ENOENT');
		expect(calls).toBe(1);
	});

	test('the default ceiling still spends its re-emit on object-free prose — every other caller is untouched', async () => {
		const { driver, prompts, isReemit } = setupRerun({ replies: [{ text: objectFreeRejection, exitCode: 0 }] });

		const { ok } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport }));

		expect(ok).toBe(false);
		expect(prompts.length).toBe(2);
		expect(prompts.map(isReemit)).toStrictEqual([false, true]);
	});

	test('every rung of the ladder carries the role system prompt unchanged — a re-run is the same role, told apart by its own prompt', async () => {
		const { driver, systemPrompts, prompts, onRejectedOutput, isReemit } = setupRerun({ replies: [{ text: objectBearingRejection, exitCode: 0 }] });

		const { ok } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2, onRejectedOutput }),
		);

		expect(ok).toBe(false);
		// a caller that reads the system prompt to tell one role's calls apart —
		// the grade pass reads its reader lens from there — sees all four rungs as
		// the same role, and must use the prompt to tell a re-emit from a re-run
		expect(systemPrompts).toStrictEqual(['ROLE-SYSTEM-PROMPT', 'ROLE-SYSTEM-PROMPT', 'ROLE-SYSTEM-PROMPT', 'ROLE-SYSTEM-PROMPT']);
		expect(prompts.map(isReemit)).toStrictEqual([false, true, false, true]);
	});

	test('a payload that parses as bare null earns no re-emit either — parsing is not the same as holding an object', async () => {
		const { driver, prompts, rejections, onRejectedOutput } = setupRerun({ replies: [{ text: nullRejection, exitCode: 0 }] });

		const { ok } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 2, onRejectedOutput }),
		);

		expect(ok).toBe(false);
		expect(prompts.length).toBe(2);
		expect(rejections.map(({ text, attempt }) => ({ text, attempt }))).toStrictEqual([
			{ text: 'null', attempt: 1 },
			{ text: 'null', attempt: 2 },
		]);
	});

	test('a ceiling below one spawns nothing at all and says so', async () => {
		const { driver, prompts, rejections, onRejectedOutput } = setupRerun({ replies: [{ text: objectBearingRejection, exitCode: 0 }] });

		const { ok, rateLimited, failure, usage } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, maxRoleAttempts: 0, onRejectedOutput }),
		);

		expect(ok).toBe(false);
		expect(rateLimited).toBe(false);
		// deliberately unguarded: the parameter is internal, and a ladder with no
		// rungs reports honestly rather than throwing at a value no caller passes
		expect(failure).toBe('no attempts made');
		expect(usage).toBe(undefined);
		expect(prompts.length).toBe(0);
		expect(rejections.length).toBe(0);
	});
});
