import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, test } from '@jest/globals';
import type { ActivityLevel } from '#src/activity/index.ts';
import { type HarnessProcessMark, WorkReport } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation, DriverResult } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';
import { report } from '#tests/helpers/report.ts';

const roleInvocation = { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' };

/** What `recordProcess` is handed: the mark less the two fields the handle itself supplies. */
type RecordedProcess = Omit<HarnessProcessMark, 'kind' | 'levelId'>;

/** One spawn's behaviour — answering, streaming usage, stalling, or throwing. */
type Spawn = (invocation: DriverInvocation) => Promise<DriverResult>;

const stubUsage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 };

/**
 * A driver whose spawns behave as given, in order, and a level handle that
 * collects every process mark written under it.
 *
 * `recordProcessFails` makes the handle throw instead of collecting, which is
 * how a record that cannot be written is told apart from one that was never
 * asked for.
 */
const setupActivity = ({ spawns, recordProcessFails = false }: { spawns: Spawn[]; recordProcessFails?: boolean }) => {
	const marks: RecordedProcess[] = [];

	const activity: ActivityLevel = {
		id: 'level-under-test',
		open: () => activity,
		close: () => undefined,
		recordProcess: (process) => {
			if (recordProcessFails) {
				throw new Error('activity record is unwritable');
			}

			marks.push(process);
		},
		settled: async () => undefined,
	};

	let spawned = 0;
	const driver: Driver = {
		name: 'stub-harness',
		invoke: async (invocation) => {
			spawned += 1;

			return spawns[spawned - 1](invocation);
		},
	};

	return { driver, activity, marks };
};

describe('invokeAgentWithContract', () => {
	test('a rejected answer and its re-emit are recorded as two harness processes, not one', async () => {
		const { driver, activity, marks } = setupActivity({
			spawns: [async () => ({ text: 'prose with no report in it', exitCode: 0 }), async () => ({ text: report({ summary: 're-emitted' }), exitCode: 0 })],
		});

		const { report: parsed } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(parsed?.summary).toBe('re-emitted');
		expect(marks.map(({ harness, spawn, reemit, endReason }) => ({ harness, spawn, reemit, endReason }))).toStrictEqual([
			{ harness: 'stub-harness', spawn: 1, reemit: false, endReason: 'completed' },
			{ harness: 'stub-harness', spawn: 2, reemit: true, endReason: 'completed' },
		]);
	});

	test('a spawn that throws still records the usage it reported before it died', async () => {
		const { driver, activity, marks } = setupActivity({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 1200, cacheReadTokens: 34_000, cacheCreationTokens: 900 });
					onUsage?.({ inputTokens: 2400, cacheReadTokens: 51_000, cacheCreationTokens: 900 });

					throw new Error('harness process killed');
				},
			],
		});

		const { failure } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(failure).toMatch(/agent invocation failed/);
		expect(marks[0]).toEqual(expect.objectContaining({ endReason: 'failed', usage: { inputTokens: 2400, cacheReadTokens: 51_000, cacheCreationTokens: 900 } }));
	});

	test('a process that reported no usage records no usage rather than zeros', async () => {
		const { driver, activity, marks } = setupActivity({ spawns: [async () => ({ text: report(), exitCode: 0 })] });

		const { ok } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		expect(marks[0].endReason).toBe('completed');
		expect(marks[0].usage).toBe(undefined);
	});

	test("a spawn that returned usage records the result's own counts, not the running total it streamed", async () => {
		const { driver, activity, marks } = setupActivity({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 4, cacheReadTokens: 400 });

					return { text: report(), exitCode: 0, usage: stubUsage };
				},
			],
		});

		const { ok } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		expect(marks[0].usage).toStrictEqual({ inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 });
	});

	test('a spawn that returned a result without usage records what its stream reported', async () => {
		const { driver, activity, marks } = setupActivity({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 900, cacheReadTokens: 12_000, cacheCreationTokens: 60 });

					return { text: report(), exitCode: 0 };
				},
			],
		});

		const { ok } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		expect(marks[0].usage).toStrictEqual({ inputTokens: 900, cacheReadTokens: 12_000, cacheCreationTokens: 60 });
	});

	test('a rate-limited spawn records the rate-limit end reason', async () => {
		const { driver, activity, marks } = setupActivity({ spawns: [async () => ({ text: '', exitCode: 1, rateLimited: true, usage: stubUsage })] });

		const { rateLimited } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(rateLimited).toBe(true);
		expect(marks[0].endReason).toBe('rate-limited');
	});

	test('a rejection at the ceiling records timed-out and an early rejection records failed', async () => {
		const ceilingMs = 30;
		const killed = setupActivity({
			spawns: [
				async () => {
					await delay(ceilingMs * 3);

					throw new Error('killed');
				},
			],
		});
		const neverStarted = setupActivity({
			spawns: [
				async () => {
					throw new Error('spawn ENOENT');
				},
			],
		});

		await invokeAgentWithContract({
			driver: killed.driver,
			activity: killed.activity,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			timeoutMs: ceilingMs,
		});
		await invokeAgentWithContract({
			driver: neverStarted.driver,
			activity: neverStarted.activity,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			timeoutMs: 600_000,
		});

		expect([killed.marks[0].endReason, neverStarted.marks[0].endReason]).toStrictEqual(['timed-out', 'failed']);
	});

	test('each process mark carries its own start and end time', async () => {
		const { driver, activity, marks } = setupActivity({
			spawns: [
				async () => {
					await delay(15);

					return { text: report(), exitCode: 0 };
				},
			],
		});

		const { ok } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		expect(marks[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(marks[0].endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(Date.parse(marks[0].endedAt)).toBeGreaterThan(Date.parse(marks[0].startedAt));
	});

	test('each process mark carries the model and effort its spawn ran under, and none when neither was set', async () => {
		const chosen = setupActivity({
			spawns: [async () => ({ text: 'prose with no report in it', exitCode: 0 }), async () => ({ text: report(), exitCode: 0 })],
		});
		const harnessDefaults = setupActivity({ spawns: [async () => ({ text: report(), exitCode: 0 })] });

		await invokeAgentWithContract({
			driver: chosen.driver,
			activity: chosen.activity,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
			model: 'claude-opus-5',
			effort: 'high',
		});
		await invokeAgentWithContract({
			driver: harnessDefaults.driver,
			activity: harnessDefaults.activity,
			cwd: '.',
			invocation: roleInvocation,
			contract: WorkReport,
		});

		expect(chosen.marks.map(({ model, effort }) => ({ model, effort }))).toStrictEqual([
			{ model: 'claude-opus-5', effort: 'high' },
			{ model: 'claude-opus-5', effort: 'high' },
		]);
		expect(harnessDefaults.marks[0].model).toBe(undefined);
		expect(harnessDefaults.marks[0].effort).toBe(undefined);
	});

	test('a record that cannot be written never fails the agent call', async () => {
		const { driver, activity, marks } = setupActivity({
			spawns: [async () => ({ text: report({ summary: 'delivered' }), exitCode: 0, usage: stubUsage })],
			recordProcessFails: true,
		});

		const { report: parsed, usage } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }),
		);

		expect(parsed?.summary).toBe('delivered');
		expect(usage).toStrictEqual({ inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 });
		expect(marks).toStrictEqual([]);
	});

	test('with no level handle the ladder behaves exactly as before', async () => {
		const { driver } = setupActivity({
			spawns: [
				async () => ({ text: 'prose with no report in it', exitCode: 0, usage: stubUsage }),
				async () => ({ text: report({ summary: 're-emitted' }), exitCode: 0, usage: stubUsage }),
			],
		});

		const { ok, report: parsed, usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport }));

		expect(ok).toBe(true);
		expect(parsed?.summary).toBe('re-emitted');
		expect(usage).toStrictEqual({ inputTokens: 20, outputTokens: 200, cacheReadTokens: 2000, cacheCreationTokens: 10, costUsd: 1 });
	});
});
