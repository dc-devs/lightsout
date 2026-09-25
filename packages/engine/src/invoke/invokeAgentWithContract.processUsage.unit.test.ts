import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, test } from '@jest/globals';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import { WorkReport } from '#src/contracts/work/WorkReport.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import type { DriverResult } from '#src/drivers/common/types/DriverResult.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';
import { report } from '#tests/helpers/report.ts';

const roleInvocation = { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' };

/** What `recordProcess` is handed: the mark less the two fields the handle itself supplies. */
type RecordedProcess = Omit<HarnessProcessMark, 'kind' | 'levelId'>;

/** One spawn's behaviour — answering, streaming usage, stalling, or throwing. */
type Spawn = (invocation: DriverInvocation) => Promise<DriverResult>;

/** A full result envelope, the figure a settled spawn hands back untouched. */
const envelopeUsage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 5, costUsd: 0.5 };

/**
 * A driver whose spawns behave as given, in order, and a level handle that
 * collects every process mark written under it.
 *
 * `recordProcessFails` makes the handle throw instead of collecting, which is
 * how an unwritable activity record is told apart from one that was never
 * asked for.
 */
const setupProcessUsage = ({ spawns, recordProcessFails = false }: { spawns: Spawn[]; recordProcessFails?: boolean }) => {
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
	test('a spawn killed after streaming still bills the call for the tokens it reported', async () => {
		const { driver, activity } = setupProcessUsage({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 1200, cacheReadTokens: 34_000, cacheCreationTokens: 900 });
					onUsage?.({ inputTokens: 2400, cacheReadTokens: 51_000, cacheCreationTokens: 900 });

					throw new Error('harness process killed');
				},
			],
		});

		const { failure, usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(failure).toMatch(/agent invocation failed/);
		// the harness states output tokens and cost only in a terminal result event
		// this spawn never reached, so those two fields are a real nothing
		expect(usage).toStrictEqual({ inputTokens: 2400, outputTokens: 0, cacheReadTokens: 51_000, cacheCreationTokens: 900, costUsd: 0 });
	});

	test("the activity mark and the call's usage carry the same numbers for one killed spawn", async () => {
		const ceilingMs = 30;
		const { driver, activity, marks } = setupProcessUsage({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 3300, cacheReadTokens: 64_000, cacheCreationTokens: 120 });
					await delay(ceilingMs * 3);

					throw new Error('killed at the ceiling');
				},
			],
		});

		const { usage } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity, timeoutMs: ceilingMs }),
		);

		expect(marks[0]).toEqual(
			expect.objectContaining({ endReason: 'timed-out', usage: { inputTokens: 3300, cacheReadTokens: 64_000, cacheCreationTokens: 120 } }),
		);
		// field for field the same numbers the mark carries, so the run total and the
		// activity report cannot disagree about this one spawn
		expect(usage).toStrictEqual({ inputTokens: 3300, outputTokens: 0, cacheReadTokens: 64_000, cacheCreationTokens: 120, costUsd: 0 });
	});

	test('a settled spawn with no usage envelope bills the call for what its stream reported', async () => {
		const { driver, activity } = setupProcessUsage({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 900, cacheReadTokens: 12_000, cacheCreationTokens: 60 });

					return { text: report({ summary: 'delivered' }), exitCode: 0 };
				},
			],
		});

		const { ok, usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		expect(usage).toStrictEqual({ inputTokens: 900, outputTokens: 0, cacheReadTokens: 12_000, cacheCreationTokens: 60, costUsd: 0 });
	});

	test("a killed rung adds to the earlier rung's bill rather than replacing it", async () => {
		const { driver, activity } = setupProcessUsage({
			spawns: [
				// valid JSON the contract turns down, which is what makes the ladder
				// spawn its re-emit rung at all
				async () => ({ text: report({ summary: 42 }), exitCode: 0, usage: envelopeUsage }),
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 2000, cacheReadTokens: 30_000, cacheCreationTokens: 40 });

					throw new Error('harness process killed');
				},
			],
		});

		const { failure, usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(failure).toMatch(/agent invocation failed/);
		expect(usage).toStrictEqual({ inputTokens: 2010, outputTokens: 100, cacheReadTokens: 31_000, cacheCreationTokens: 45, costUsd: 0.5 });
	});

	test('a call whose spawns reported nothing reports no usage rather than zeros', async () => {
		const { driver, activity } = setupProcessUsage({
			spawns: [async () => ({ text: 'prose with no report in it', exitCode: 0 }), async () => ({ text: report(), exitCode: 0 })],
		});

		const { ok, usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		expect(usage).toBe(undefined);
	});

	test('a usage figure with no field reported leaves the total exactly as it was', async () => {
		const { driver, activity } = setupProcessUsage({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({});

					return { text: report(), exitCode: 0 };
				},
			],
		});

		const { ok, usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		// an empty figure is silence, never five zeroes
		expect(usage).toBe(undefined);
	});

	test('a zero the harness stated is billed as a zero, not read as silence', async () => {
		const { driver, activity } = setupProcessUsage({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 0, costUsd: 0 });

					return { text: report(), exitCode: 0 };
				},
			],
		});

		const { ok, usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(ok).toBe(true);
		// a field reported as zero is a figure the harness stated, so the call is
		// billed zero — only a field nobody reported at all counts as nothing
		expect(usage).toStrictEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 });
	});

	test('an unwritable activity record does not cost the call its usage', async () => {
		const { driver, activity, marks } = setupProcessUsage({
			spawns: [
				async ({ onUsage }) => {
					onUsage?.({ inputTokens: 700, cacheReadTokens: 8000, cacheCreationTokens: 25 });

					throw new Error('harness process killed');
				},
			],
			recordProcessFails: true,
		});

		const { usage } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, activity }));

		expect(marks).toStrictEqual([]);
		expect(usage).toStrictEqual({ inputTokens: 700, outputTokens: 0, cacheReadTokens: 8000, cacheCreationTokens: 25, costUsd: 0 });
	});
});
