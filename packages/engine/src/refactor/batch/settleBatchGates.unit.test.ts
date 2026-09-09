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
	coordination: coordinationReason,
};

/** An ordinary red: the gates ran and the unit-test family lost, which is evidence a fix agent may act on. */
const redGates: GateRunResult = {
	error: 'unit tests failed: 3 failing in src/one.unit.test.ts',
	failedFamilies: ['test'],
	crashes: [],
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
});
