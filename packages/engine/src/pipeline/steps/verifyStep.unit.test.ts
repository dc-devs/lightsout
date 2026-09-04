import { describe, expect, jest, test } from '@jest/globals';
import { type GateResult, type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep.ts';
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

/**
 * A PipelineRun stub carrying only what the verification step touches: every
 * stop is captured rather than thrown, every agent event sink and role
 * invocation is recorded, and the driver throws — so an agent this test says
 * is never spawned is loud rather than silent if it is.
 */
const setupVerifyRun = ({ result }: { result: GateRunResult & { failures: GateResult[] } }) => {
	mockRunVerificationGates.mockResolvedValue(result);

	const manifest = { runId: 'run-1', steps: [], changedFiles: [], packages: [], ledgerTests: [] } as unknown as RunManifest;
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

describe('verifyStep', () => {
	test('verifyStep: a gate error with no failed family escalates without consulting the supervisor', async () => {
		const gateError =
			'gate-overrides named no gate this run could execute: check, test-e2e — every named gate is absent from the group(s) that ran at this checkpoint';
		const { run, agentSinks, roleInvocations, stopped } = setupVerifyRun({
			result: { error: gateError, failedFamilies: [], crashes: [], failures: [] },
		});

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-implement',
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
});
