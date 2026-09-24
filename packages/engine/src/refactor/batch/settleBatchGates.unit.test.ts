import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, SupervisorDecision, type SupervisorVerdict } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { SettleKind } from '#src/refactor/batch/common/constants/SettleKind.ts';
import { settleBatchGates } from '#src/refactor/batch/settleBatchGates.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { seedRunFolder } from '#tests/helpers/seedRunFolder.ts';

// Mocked Imports
// -------------------------
// The supervisor is a real agent spawn with its own suite. Here it is a stub, so
// these tests can say exactly whether the exception path was reached at all —
// and, when it was, hand back the verdict the case needs.
const mockConsultSupervisor = jest.fn<() => Promise<AgentOutcome<SupervisorVerdict>>>();

jest.mock('#src/common/utils/consultSupervisor.ts', () => ({
	consultSupervisor: () => mockConsultSupervisor(),
}));
// -------------------------

const batchId = 'batch-01:multi-export:src';

/** The reason a gate run answers when it never got the machine: no command ran, so no family failed. */
const coordinationReason = 'gates did not start: run run-7 holds the machine in /repo/.worktrees/lo-42, taken 31m ago — waited 30m';

const coordinationGates: GateRunResult = {
	error: coordinationReason,
	failedFamilies: [],
	crashes: [],
	timeouts: [],
	coordination: coordinationReason,
};

/** An ordinary red: the gates ran and the unit-test family lost, which is evidence a fix agent may act on. */
const redGates: GateRunResult = {
	error: 'unit tests failed: 3 failing in src/one.unit.test.ts',
	failedFamilies: ['test'],
	crashes: [],
	timeouts: [],
	coordination: undefined,
};

/** A gate that died in the known jest worker crash on every attempt: no verdict, so no family failed. */
const crashLine = 'test crashed: every attempt ended in the known jest worker SIGSEGV, so this gate never returned a verdict.';

const crashGates: GateRunResult = {
	error: `${crashLine}\n\nSegmentation fault (core dumped)`,
	failedFamilies: [],
	crashes: [crashLine],
	timeouts: [],
	coordination: undefined,
};

/** A gate that ran past its own ceiling on every attempt: no verdict, so no family failed. */
const timeoutLine = 'test timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.';

const timeoutGates: GateRunResult = {
	error: `${timeoutLine}\n\nrunCommand: timed out after 900000ms`,
	failedFamilies: [],
	crashes: [],
	timeouts: [timeoutLine],
	coordination: undefined,
};

interface SetupParams {
	/** What the gates answer, one entry per gate run; the last entry repeats once the list is spent. */
	gates: GateRunResult[];
	/** The supervisor's ruling, when the case expects the exception path to be reached. */
	verdict?: SupervisorVerdict;
}

/**
 * A settle whose gates answer from a scripted list, whose fix invocations are
 * recorded rather than spawned, and whose driver throws — so an agent these
 * tests say is never spawned is loud rather than silent if it is.
 */
const setupSettle = ({ gates, verdict }: SetupParams) => {
	mockConsultSupervisor.mockResolvedValue(
		verdict ? { ok: true, report: verdict } : { ok: false, failure: 'the supervisor was not expected on this path', rateLimited: false },
	);

	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-settle-gates-'));

	// The run below already has its folder, because `createRun` makes one before
	// a run starts and the gate evidence looks the run up by id.
	seedRunFolder({ cwd, runId: 'run-1', pipeline: 'refactor' });

	const fixLabels: string[] = [];
	let gateCall = 0;

	return {
		fixLabels,
		run: () =>
			settleBatchGates({
				cwd,
				runId: 'run-1',
				driver: createUncalledDriver({ reason: 'settleBatchGates spawned an agent through the driver' }),
				config: { gates: { check: 'true', test: 'true' } } as unknown as LightsoutConfig,
				batchId,
				planContent: 'the plan',
				attempts: 1,
				onProgress: () => {},
				recordUsage: async () => {},
				invokeFix: async ({ label }: { label: string; gateError: string; guidance?: string }): Promise<AgentOutcome<unknown>> => {
					fixLabels.push(label);

					return { ok: true, report: {} };
				},
				gates: async () => {
					const answer = gates[Math.min(gateCall, gates.length - 1)] ?? coordinationGates;
					gateCall += 1;

					return answer;
				},
			}),
	};
};

describe('settleBatchGates', () => {
	test('settleBatchGates: a coordination failure escalates without spending a fix or a supervisor', async () => {
		const { run, fixLabels } = setupSettle({ gates: [coordinationGates] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(coordinationReason) });
		// the gates never ran, so there is nothing for a fix agent to repair and
		// nothing for a supervisor to rule on
		expect(fixLabels).toStrictEqual([]);
		expect(mockConsultSupervisor).not.toHaveBeenCalled();
	});

	test('settleBatchGates: a guided retry whose re-run never got the machine escalates naming coordination', async () => {
		const { run, fixLabels } = setupSettle({
			gates: [redGates, redGates, redGates, coordinationGates],
			verdict: {
				decision: SupervisorDecision.Retry,
				diagnosis: 'the fixture writes to a path the test never creates',
				guidance: 'create the fixture directory before writing to it',
			},
		});

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(coordinationReason) });
		// the re-run produced no verdict at all, so reporting the gates as still red
		// after the fix attempts would state something no gate command established
		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.not.stringContaining('still red') });
		expect(fixLabels).toStrictEqual(['fix-1', 'fix-2', 'supervised-fix']);
		expect(mockConsultSupervisor).toHaveBeenCalledTimes(1);
	});

	test('settleBatchGates: a crashed gate escalates without spending a fix or a supervisor', async () => {
		const { run, fixLabels } = setupSettle({ gates: [crashGates] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(crashLine) });
		// a crash is no verdict about the code, so a fix agent has nothing to repair
		expect(fixLabels).toStrictEqual([]);
		expect(mockConsultSupervisor).not.toHaveBeenCalled();
	});

	test('settleBatchGates: a timed-out gate escalates without spending a fix or a supervisor', async () => {
		const { run, fixLabels } = setupSettle({ gates: [timeoutGates] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(timeoutLine) });
		// a gate stopped by its own ceiling is no verdict about the code either
		expect(fixLabels).toStrictEqual([]);
		expect(mockConsultSupervisor).not.toHaveBeenCalled();
	});

	test('settleBatchGates: a timeout on a re-run inside the cheap loop stops before the next fix', async () => {
		const { run, fixLabels } = setupSettle({ gates: [redGates, timeoutGates] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(timeoutLine) });
		// the first red earned one fix; the re-run after it reached no verdict, so
		// a second fix would repair a red no gate command established
		expect(fixLabels).toStrictEqual(['fix-1']);
		expect(mockConsultSupervisor).not.toHaveBeenCalled();
	});

	test('settleBatchGates: a guided retry whose re-run timed out escalates naming the timeout rather than a red', async () => {
		const { run, fixLabels } = setupSettle({
			gates: [redGates, redGates, redGates, timeoutGates],
			verdict: {
				decision: SupervisorDecision.Retry,
				diagnosis: 'the fixture writes to a path the test never creates',
				guidance: 'create the fixture directory before writing to it',
			},
		});

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(timeoutLine) });
		// the guided re-run ran past its ceiling, so saying the gates are still red
		// would state a verdict no gate command returned
		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.not.stringContaining('still red') });
		expect(fixLabels).toStrictEqual(['fix-1', 'fix-2', 'supervised-fix']);
	});
});
