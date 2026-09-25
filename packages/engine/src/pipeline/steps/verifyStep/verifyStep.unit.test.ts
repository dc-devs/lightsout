import { describe, expect, jest, test } from '@jest/globals';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { PipelineRun } from '#src/pipeline/internal/PipelineRun.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/verifyStep.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';

// Mocked Imports
// -------------------------
const mockRunVerificationGates =
	jest.fn<(params: { run: PipelineRun; coverage?: boolean; checkpoint: string }) => Promise<GateRunResult & { failures: GateResult[] }>>();

jest.mock('#src/pipeline/internal/common/utils/runVerificationGates.ts', () => ({
	runVerificationGates: (params: { run: PipelineRun; coverage?: boolean; checkpoint: string }) => mockRunVerificationGates(params),
}));
// -------------------------
interface HoldParams {
	cwd: string;
	config: LightsoutConfig;
	ticketRef: string | undefined;
	runId: string;
	worktreePath: string;
	reason: string;
}

const mockTakeGateHold = jest.fn<(params: HoldParams) => Promise<string | undefined>>();

jest.mock('#src/gates/gateHolds/takeGateHold.ts', () => ({ takeGateHold: (params: HoldParams) => mockTakeGateHold(params) }));
// -------------------------
interface WorkOrderTicketRefParams {
	cwd: string;
}

const mockReadWorkOrderTicketRef = jest.fn<(params: WorkOrderTicketRefParams) => Promise<string | undefined>>();

jest.mock('#src/workOrder/readWorkOrderTicketRef.ts', () => ({
	readWorkOrderTicketRef: (params: WorkOrderTicketRefParams) => mockReadWorkOrderTicketRef(params),
}));
// -------------------------

/** A PipelineRun stub that records stops and role invocations. Its driver throws, so an unexpected agent fails loudly. */
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

/** A stub whose fix role answers. No formatter is configured, so after a fix the step goes straight back to the gates. */
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

		expect(roleInvocations).toStrictEqual([]);
		expect(agentSinks).toStrictEqual([]);
		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(escalation?.error).toEqual(expect.stringContaining(timeout));
	});

	test('verifyStep: a crash and a timeout in one run stop on the crash first, with the full output beside it', async () => {
		const crash = 'test crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.';
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

		const error = stopped()?.error ?? '';

		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(error).toMatch(/^verify-implement: a gate crashed/);
		expect(error).toEqual(expect.stringContaining(crash));
		expect(error).toEqual(expect.stringContaining(gateOutput));
		expect(roleInvocations).toStrictEqual([]);
	});
});
