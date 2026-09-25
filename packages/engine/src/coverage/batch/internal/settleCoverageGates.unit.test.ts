import { describe, expect, test } from '@jest/globals';
import { settleCoverageGates } from '#src/coverage/batch/internal/settleCoverageGates.ts';
import { CoverageBatchStopKind } from '#src/coverage/internal/common/constants/CoverageBatchStopKind.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';

/** One gate verdict, green unless the case says otherwise, with every channel spelled. */
const gateResultOf = (overrides: Partial<GateRunResult> = {}): GateRunResult => ({
	error: undefined,
	failedFamilies: [],
	crashes: [],
	timeouts: [],
	coordination: undefined,
	...overrides,
});

/**
 * The settler with recording stubs for the three things it can spend: a fix
 * invocation, the tests-only re-check that follows one, and the gate run
 * itself. Every stub records its calls, so a test can assert what was NOT
 * spent as directly as what was.
 */
const setupSettle = ({ gate, fix = { ok: true, report: {} } }: { gate: GateRunResult; fix?: AgentOutcome<unknown> }) => {
	const progress: string[] = [];
	const fixCalls: { label: string; errorContext: string }[] = [];
	const testsOnlyCalls: string[] = [];
	const gateCalls: string[] = [];

	return {
		progress,
		fixCalls,
		testsOnlyCalls,
		gateCalls,
		run: () =>
			settleCoverageGates({
				batchId: 'batch-01:src/target.ts',
				onProgress: (message: string) => progress.push(message),
				invokeFix: async (params: { label: string; errorContext: string }) => {
					fixCalls.push(params);

					return fix;
				},
				testsOnly: async () => {
					testsOnlyCalls.push('checked');

					return undefined;
				},
				gates: async () => {
					gateCalls.push('ran');

					return gate;
				},
			}),
	};
};

describe('settleCoverageGates', () => {
	test('settleCoverageGates: a coordination failure escalates without spending a fix attempt', async () => {
		const { run, fixCalls, testsOnlyCalls } = setupSettle({
			gate: gateResultOf({
				error: 'gates did not run: another run holds the machine',
				coordination: 'run r-77 holds the machine in worktree /repo/.worktrees/lo-42, held for 31m',
			}),
		});

		const stop = await run();

		expect(stop).toEqual({
			kind: CoverageBatchStopKind.Escalated,
			error: expect.stringContaining('run r-77 holds the machine in worktree /repo/.worktrees/lo-42, held for 31m'),
		});
		expect(fixCalls).toStrictEqual([]);
		expect(testsOnlyCalls).toStrictEqual([]);
	});

	test('settleCoverageGates: a crashed gate escalates without spending a fix attempt', async () => {
		const { run, fixCalls, testsOnlyCalls } = setupSettle({
			gate: gateResultOf({
				error: 'test (exit -1): jest worker SIGSEGV',
				crashes: ['packages/engine test crashed: every attempt died in the jest worker crash'],
			}),
		});

		const stop = await run();

		expect(stop).toEqual({
			kind: CoverageBatchStopKind.Escalated,
			error: expect.stringContaining('packages/engine test crashed: every attempt died in the jest worker crash'),
		});
		expect(fixCalls).toStrictEqual([]);
		expect(testsOnlyCalls).toStrictEqual([]);
	});

	test('settleCoverageGates: a timed-out gate escalates without spending a fix attempt', async () => {
		const { run, fixCalls, testsOnlyCalls } = setupSettle({
			gate: gateResultOf({
				error: 'test (exit -1): timed out after 900000ms',
				timeouts: ['packages/engine test timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes)'],
			}),
		});

		const stop = await run();

		expect(stop).toEqual({
			kind: CoverageBatchStopKind.Escalated,
			error: expect.stringContaining('packages/engine test timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes)'),
		});
		expect(fixCalls).toStrictEqual([]);
		expect(testsOnlyCalls).toStrictEqual([]);
	});
});
