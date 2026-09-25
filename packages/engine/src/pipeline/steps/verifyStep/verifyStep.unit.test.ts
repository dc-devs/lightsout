import { describe, expect, jest, test } from '@jest/globals';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/verifyStep.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';

// Mocked Imports
// -------------------------
// The gates are the one thing this step reads a verdict from, and they have
// their own tests. What is under test here is what the step does with a
// verdict, so the verdict is handed to it directly.
const mockRunVerificationGates =
	jest.fn<(params: { run: PipelineRun; coverage?: boolean; checkpoint: string }) => Promise<GateRunResult & { failures: GateResult[] }>>();

jest.mock('#src/pipeline/common/utils/runVerificationGates.ts', () => ({
	runVerificationGates: (params: { run: PipelineRun; coverage?: boolean; checkpoint: string }) => mockRunVerificationGates(params),
}));
// -------------------------
// The durable hold a checkpoint takes when the gates never got the machine. It
// is another module's entry point with its own tests: what is under test here is
// whether the checkpoint takes one at all, and what it does with the sentence a
// hold the tracker refused answers with.
interface HoldParams {
	cwd: string;
	config: LightsoutConfig;
	ticketRef: string | undefined;
	runId: string;
	worktreePath: string;
	reason: string;
}

const mockTakeGateHold = jest.fn<(params: HoldParams) => Promise<string | undefined>>();

jest.mock('#src/gates/index.ts', () => ({ takeGateHold: (params: HoldParams) => mockTakeGateHold(params) }));
// -------------------------
// Which ticket the checkout's branch belongs to is the work order record's
// answer, handed here directly rather than by making a git checkout and a
// record for it.
interface WorkOrderTicketRefParams {
	cwd: string;
}

const mockReadWorkOrderTicketRef = jest.fn<(params: WorkOrderTicketRefParams) => Promise<string | undefined>>();

jest.mock('#src/workOrder/index.ts', () => ({ readWorkOrderTicketRef: (params: WorkOrderTicketRefParams) => mockReadWorkOrderTicketRef(params) }));
// -------------------------

/**
 * A PipelineRun stub carrying only what the verification step touches: every
 * stop is captured rather than thrown, every agent event sink and role
 * invocation is recorded, and the driver throws — so an agent this test says
 * is never spawned is loud rather than silent if it is.
 */
const setupVerifyRun = ({
	result,
	ticketRef,
	holdFailure,
}: {
	result: GateRunResult & { failures: GateResult[] };
	ticketRef?: string;
	holdFailure?: string;
}) => {
	mockRunVerificationGates.mockResolvedValue(result);
	mockReadWorkOrderTicketRef.mockResolvedValue(ticketRef);
	mockTakeGateHold.mockResolvedValue(holdFailure);

	const manifest = { runId: 'run-1', steps: [], changedFiles: [], packages: [], acceptanceTests: [], approvedTests: [] } as unknown as RunManifest;
	const progress: string[] = [];
	const agentSinks: string[] = [];
	const roleInvocations: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;

	const run = {
		cwd: '/tmp/lightsout-verify-step',
		config: {} as unknown as LightsoutConfig,
		driver: createUncalledDriver({ reason: 'no agent may be spawned over a checkpoint the engine could not run' }),
		current: () => manifest,
		progress: (message: string) => progress.push(message),
		parkMessage: () => 'run parked',
		nextRecord: ({ id }: { id: string }) => ({ id, status: RunStatus.Running, attempts: 1 }),
		setStep: async ({ record }: { record: StepRecord }) => {
			manifest.steps = [record];
		},
		stop: async ({ status, error }: { status: RunStatus; error: string }) => {
			stopped = { status, error };

			return { ok: false as const, manifest, error };
		},
		invokeRole: async ({ step }: { step: string }) => {
			roleInvocations.push(step);

			return { ok: false as const, rateLimited: false, error: 'no fix agent should run' };
		},
		agentEventSink: ({ step }: { step: string }) => {
			agentSinks.push(step);

			return () => {};
		},
		persistRejected: () => async () => {},
		recordUsage: async () => {},
	};

	return { run: run as unknown as PipelineRun, progress, agentSinks, roleInvocations, stopped: () => stopped };
};

/**
 * A `PipelineRun` stub for the ordinary red the repair budget is meant to be
 * spent on: the fix role answers rather than throwing, and the config carries a
 * gates block with no formatter, so the re-entry after a fix settles nothing on
 * disk and lands straight back on the gates.
 */
const setupRepairableRun = ({ red, green }: { red: GateRunResult & { failures: GateResult[] }; green: GateRunResult & { failures: GateResult[] } }) => {
	mockRunVerificationGates.mockResolvedValueOnce(red);
	mockRunVerificationGates.mockResolvedValue(green);

	const manifest = { runId: 'run-1', steps: [], changedFiles: [], packages: [], acceptanceTests: [], approvedTests: [] } as unknown as RunManifest;
	const agentSinks: string[] = [];
	const roleInvocations: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;

	const run = {
		cwd: '/tmp/lightsout-verify-step',
		config: { gates: {} } as unknown as LightsoutConfig,
		driver: createUncalledDriver({ reason: 'a red the cheap retries can still repair buys no supervisor' }),
		current: () => manifest,
		progress: () => {},
		parkMessage: () => 'run parked',
		nextRecord: ({ id }: { id: string }) => ({ id, status: RunStatus.Running, attempts: 1 }),
		setStep: async ({ record }: { record: StepRecord }) => {
			manifest.steps = [record];
		},
		stop: async ({ status, error }: { status: RunStatus; error: string }) => {
			stopped = { status, error };

			return { ok: false as const, manifest, error };
		},
		invokeRole: async ({ step }: { step: string }) => {
			roleInvocations.push(step);

			return { ok: false as const, rateLimited: false, error: 'the fix role answered nothing' };
		},
		agentEventSink: ({ step }: { step: string }) => {
			agentSinks.push(step);

			return () => {};
		},
		persistRejected: () => async () => {},
		recordUsage: async () => {},
	};

	return { run: run as unknown as PipelineRun, manifest, agentSinks, roleInvocations, stopped: () => stopped };
};

describe('verifyStep', () => {
	test('verifyStep: a gate error with no failed family escalates without consulting the supervisor', async () => {
		const gateError =
			'gate-overrides named no gate this run could execute: check, test-e2e — every named gate is absent from the group(s) that ran at this checkpoint';
		const { run, agentSinks, roleInvocations, stopped } = setupVerifyRun({
			result: { error: gateError, failedFamilies: [], crashes: [], timeouts: [], coordination: undefined, failures: [] },
		});

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
			acceptanceTests: () => [],
			renames: [],
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// An error with no failed family is the engine saying the checkpoint
		// could not be run, not evidence about the code: there is nothing to
		// rule on and nothing to repair, so the run escalates straight to the
		// human with the gate's own text.
		expect(escalation?.error).toEqual(expect.stringContaining(gateError));
		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(agentSinks).toStrictEqual([]);
		expect(roleInvocations).toStrictEqual([]);
	});

	test('verifyStep: a gate run that never got the machine stops escalated without spending a fix agent or a supervisor', async () => {
		const coordination =
			'another gate run holds this machine: run run-7 in worktree /repo/.worktrees/lo-42, holding the reservation for 31m — the wait of 30m expired';
		const { run, agentSinks, roleInvocations, stopped } = setupVerifyRun({
			result: { error: 'gates did not run', failedFamilies: [], crashes: [], timeouts: [], coordination, failures: [] },
		});

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
			acceptanceTests: () => [],
			renames: [],
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// No gate command executed, so the checkpoint holds no evidence about the
		// code: the run ends for the human with the reason naming who holds the
		// machine, and it may not read as a red that survived the repair budget —
		// nothing was repaired, and no fix attempt was spent.
		expect(escalation?.error).toEqual(expect.stringContaining(coordination));
		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(stopped()?.error).toEqual(expect.not.stringContaining('still failing after retries'));
		expect(roleInvocations).toStrictEqual([]);
		expect(agentSinks).toStrictEqual([]);
	});

	test('verifyStep: an ordinary red with a failed family still spends the cheap repair budget', async () => {
		const { run, manifest, agentSinks, roleInvocations, stopped } = setupRepairableRun({
			red: { error: 'test suite failed', failedFamilies: ['test'], crashes: [], timeouts: [], coordination: undefined, failures: [] },
			green: { error: undefined, failedFamilies: [], crashes: [], timeouts: [], coordination: undefined, failures: [] },
		});

		const outcome = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
			acceptanceTests: () => [],
			renames: [],
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// A red carrying a failed family is evidence about the code, and the guard
		// that steps aside for a gate run which never started must not touch it: the
		// checkpoint's own fix role is invoked, the gates are re-run on the tree it
		// left, and the green that follows passes the step rather than stopping it.
		expect(roleInvocations).toStrictEqual(['verify-implement']);
		expect(mockRunVerificationGates).toHaveBeenCalledTimes(2);
		expect(manifest.steps[0]).toEqual(expect.objectContaining({ status: RunStatus.Passed }));
		expect(outcome).toBeUndefined();
		expect(stopped()).toBeUndefined();
		expect(agentSinks).toStrictEqual([]);
	});

	test('verifyStep: a hold the tracker refused is reported beside the reason the gates never ran', async () => {
		const coordination =
			'another gate run holds this machine: run run-7 in worktree /repo/.worktrees/lo-42, holding the reservation for 31m — the wait of 30m expired';
		const holdFailure = "the 'queue-blocked-gate-timed-out' label could not be written: the tracker answered 403 forbidden";
		const { run, stopped } = setupVerifyRun({
			result: { error: 'gates did not run', failedFamilies: [], crashes: [], timeouts: [], coordination, failures: [] },
			ticketRef: 'LO-118',
			holdFailure,
		});

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
			acceptanceTests: () => [],
			renames: [],
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// The hold is taken for the ticket this checkout's branch carries, naming
		// the run and the worktree that took it. A tracker that refused the label
		// is reported rather than swallowed: the local record already blocks the
		// ticket, so the person reading the run's ending has to be told why the
		// label they would look for is not on it.
		expect(mockTakeGateHold).toHaveBeenCalledWith(
			expect.objectContaining({ ticketRef: 'LO-118', runId: 'run-1', worktreePath: '/tmp/lightsout-verify-step', reason: coordination }),
		);
		expect(escalation?.error).toEqual(expect.stringContaining(holdFailure));
		expect(escalation?.error).toEqual(expect.stringContaining(coordination));
		expect(stopped()?.status).toBe(RunStatus.Escalated);
	});

	test('verifyStep: a gate that ran past its ceiling stops escalated without spending a fix agent or a supervisor', async () => {
		const timeout = 'test-e2e timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.';
		const { run, agentSinks, roleInvocations, stopped } = setupVerifyRun({
			result: {
				error: 'test-e2e: exit -1 (timeout at the 15-minute ceiling)',
				failedFamilies: [],
				crashes: [],
				timeouts: [timeout],
				coordination: undefined,
				failures: [],
			},
		});

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
			acceptanceTests: () => [],
			renames: [],
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// A gate stopped by its own ceiling returned no verdict about the code, so
		// the run ends for the human naming the timeout: it may not read as a red
		// that survived the repair budget, because no fix was spent on it.
		expect(escalation?.error).toEqual(expect.stringContaining(timeout));
		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(stopped()?.error).toEqual(expect.not.stringContaining('still failing after retries'));
		expect(roleInvocations).toStrictEqual([]);
		expect(agentSinks).toStrictEqual([]);
	});

	test('verifyStep: a timeout beside a failed family still spends no fix, because the run has no whole verdict', async () => {
		const timeout = 'test-e2e timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.';
		const { run, agentSinks, roleInvocations, stopped } = setupVerifyRun({
			result: {
				error: 'check: exit 1\n\ntest-e2e: exit -1 (timeout at the 15-minute ceiling)',
				failedFamilies: ['check'],
				crashes: [],
				timeouts: [timeout],
				coordination: undefined,
				failures: [],
			},
		});

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
			acceptanceTests: () => [],
			renames: [],
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// Verification runs every gate, so a failed family can sit beside a gate
		// that never finished. The failed family alone would be repaired, but the
		// run holds no whole verdict: no fix role is invoked on it and no
		// supervisor is consulted, and the run stops naming the timeout.
		expect(roleInvocations).toStrictEqual([]);
		expect(agentSinks).toStrictEqual([]);
		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(escalation?.error).toEqual(expect.stringContaining(timeout));
	});

	test('verifyStep: a crash and a timeout in one run stop on the crash first, with the full output beside it', async () => {
		const crash = 'test crashed: every attempt died in the known jest worker SIGSEGV, so this gate never returned a verdict.';
		const timeout = 'test-e2e timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.';
		const gateOutput = 'test: exit 139 (SIGSEGV)\n\ntest-e2e: exit -1 (timeout at the 15-minute ceiling)';
		const { run, roleInvocations, stopped } = setupVerifyRun({
			result: { error: gateOutput, failedFamilies: [], crashes: [crash], timeouts: [timeout], coordination: undefined, failures: [] },
		});

		await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
			acceptanceTests: () => [],
			renames: [],
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// The checks run coordination, then crash, then timeout, so the crash stop
		// ends the step and leads its error. The full gate output rides beside the
		// crash line, so the operator still reads which gate ran past its ceiling.
		const error = stopped()?.error ?? '';

		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(error).toMatch(/^verify-implement: a gate crashed/);
		expect(error).toEqual(expect.stringContaining(crash));
		expect(error).toEqual(expect.stringContaining(gateOutput));
		expect(roleInvocations).toStrictEqual([]);
	});
});
