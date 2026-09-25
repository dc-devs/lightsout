import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { SupervisorDecision } from '#src/contracts/work/SupervisorDecision.ts';
import type { SupervisorVerdict } from '#src/contracts/work/SupervisorVerdict.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';
import { SettleKind } from '#src/refactor/batch/internal/common/constants/SettleKind.ts';
import { settleBatchGates } from '#src/refactor/batch/internal/settleBatchGates.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { seedRunFolder } from '#tests/helpers/seedRunFolder.ts';

// Mocked Imports
// -------------------------
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

/** A gate whose test runner died on every attempt: no verdict, so no family failed. */
const crashLine = 'test crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.';

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

/** Gates answer from a scripted list and fixes are recorded. The driver throws, so an unexpected agent fails loudly. */
const setupSettle = ({ gates, verdict }: SetupParams) => {
	mockConsultSupervisor.mockResolvedValue(
		verdict ? { ok: true, report: verdict } : { ok: false, failure: 'the supervisor was not expected on this path', rateLimited: false },
	);

	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-settle-gates-'));

	// `createRun` makes the run folder before a run starts; gate evidence looks it up.
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
		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.not.stringContaining('still red') });
		expect(fixLabels).toStrictEqual(['fix-1', 'fix-2', 'supervised-fix']);
		expect(mockConsultSupervisor).toHaveBeenCalledTimes(1);
	});

	test('settleBatchGates: a crashed gate escalates without spending a fix or a supervisor', async () => {
		const { run, fixLabels } = setupSettle({ gates: [crashGates] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(crashLine) });
		expect(fixLabels).toStrictEqual([]);
		expect(mockConsultSupervisor).not.toHaveBeenCalled();
	});

	test('settleBatchGates: a timed-out gate escalates without spending a fix or a supervisor', async () => {
		const { run, fixLabels } = setupSettle({ gates: [timeoutGates] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(timeoutLine) });
		expect(fixLabels).toStrictEqual([]);
		expect(mockConsultSupervisor).not.toHaveBeenCalled();
	});

	test('settleBatchGates: a timeout on a re-run inside the cheap loop stops before the next fix', async () => {
		const { run, fixLabels } = setupSettle({ gates: [redGates, timeoutGates] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.stringContaining(timeoutLine) });
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
		expect(outcome).toEqual({ kind: SettleKind.Escalated, error: expect.not.stringContaining('still red') });
		expect(fixLabels).toStrictEqual(['fix-1', 'fix-2', 'supervised-fix']);
	});
});
